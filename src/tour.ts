// The onboarding wizard: a coach mark that walks a new user through the app.
//
// An administrator writes the steps as Markdown (Workspace settings -> Onboarding). Each
// step names something to do, not a selector — the assistant reads the live semantic UI
// snapshot and decides which control the arrow belongs on, so a step survives the button
// moving, being renamed, or living behind a tab.
//
// Two deliberate absences. There is no backdrop and no modal: the whole point is that the user
// works the control the arrow points at while reading how, so the tooltip only ever takes
// clicks on itself. And nothing advances on its own — the step stays until Next is pressed.

import { locatorFor, resolveLocator, visible, type UiLocator } from "./assistant-ui.js";
import { errorText } from "./domain.js";
import { renderMarkdown } from "./markdown.js";

/** Settings row holding the administrator's Markdown. Absent means `DEFAULT_TOUR`. */
export const TOUR_MARKDOWN_KEY = "onboarding_tour_md";

export interface TourStep {
  title: string;
  /** Markdown shown in the tooltip body. */
  body: string;
  /** The author's hint about which control to point at. Empty leaves it to the model. */
  target: string;
}

/**
 * One `##` heading per step; everything under it is the description. A `Target:` line is the
 * author overriding what the arrow points at, and is stripped out rather than shown. Anything
 * above the first `##` is the document's own title and preamble, and belongs to no step.
 */
export function parseTour(markdown: string): TourStep[] {
  const steps: TourStep[] = [];
  let current: TourStep | undefined;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1]!, body: "", target: "" };
      steps.push(current);
      continue;
    }
    if (!current)
      continue;
    const target = line.match(/^\s*(?:target|point at)\s*:\s*(.+?)\s*$/i);
    if (target) {
      current.target = target[1]!;
      continue;
    }
    current.body += `${line}\n`;
  }
  return steps.map((step) => ({ ...step, body: step.body.trim() }));
}

/**
 * The model answers with one ref from the snapshot it was shown. Only the ref is worth
 * reading, so this tolerates a fence, an apology, or a wrapper object around it. An answer
 * with no ref — including the `{"target":null}` the instructions ask for — means "point at
 * nothing", and the tooltip centres itself.
 */
export function parseTourTarget(raw: string): string {
  return /"ref"\s*:\s*"(u\d+)"/.exec(raw)?.[1] ?? "";
}

export interface TipRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TipSide = "right" | "left" | "bottom" | "top";

export interface TipPlacement {
  top: number;
  left: number;
  side: TipSide;
  /** Where the arrow sits along the tooltip's edge, in pixels from its top-left corner. */
  arrow: number;
}

/** Distance between the highlighted control and the tooltip, and from the tooltip to the edge. */
const GAP = 14;

const EDGE = 8;

/**
 * Beside the control if it fits, below or above it otherwise. Sides are tried in that order
 * because a sidebar or toolbar button — most of what a tour points at — has room next to it
 * but not under it, and a tooltip covering the thing it describes teaches nothing.
 */
export function placeTip(
  target: TipRect,
  tip: { width: number; height: number },
  view: { width: number; height: number }
): TipPlacement {
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const side: TipSide =
    right + GAP + tip.width + EDGE <= view.width
      ? "right"
      : target.left - GAP - tip.width >= EDGE
        ? "left"
        : bottom + GAP + tip.height + EDGE <= view.height
          ? "bottom"
          : target.top - GAP - tip.height >= EDGE
            ? "top"
            : "bottom";
  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(EDGE, Math.min(value, Math.max(EDGE, limit - size - EDGE)));
  // The arrow tracks the control's centre, but never past the tooltip's own rounded corners.
  const along = (centre: number, start: number, size: number): number =>
    Math.max(14, Math.min(centre - start, size - 14));
  if (side === "right" || side === "left") {
    const top = clamp(target.top + target.height / 2 - tip.height / 2, tip.height, view.height);
    return {
      top,
      left: side === "right" ? right + GAP : target.left - GAP - tip.width,
      side,
      arrow: along(target.top + target.height / 2, top, tip.height)
    };
  }
  const left = clamp(target.left + target.width / 2 - tip.width / 2, tip.width, view.width);
  return {
    top: side === "bottom" ? bottom + GAP : target.top - GAP - tip.height,
    left,
    side,
    arrow: along(target.left + target.width / 2, left, tip.width)
  };
}

export interface TourDeps {
  /** The administrator's Markdown, already parsed. */
  loadSteps: () => Promise<TourStep[]>;
  /** Asks the assistant which visible control this step is about; "" means none of them. */
  locateStep: (step: TourStep, index: number, total: number) => Promise<string>;
  /** Resolves a ref from the snapshot the assistant was shown. */
  refElement: (ref: string) => HTMLElement | null;
  onError: (message: string) => void;
}

export function createTour(deps: TourDeps) {
  const root = document.querySelector<HTMLElement>("#tour")!;
  const tip = document.querySelector<HTMLElement>("#tour-tip")!;
  const arrow = document.querySelector<HTMLElement>("#tour-arrow")!;
  const progress = document.querySelector<HTMLElement>("#tour-progress")!;
  const title = document.querySelector<HTMLElement>("#tour-title")!;
  const body = document.querySelector<HTMLElement>("#tour-body")!;
  const next = document.querySelector<HTMLButtonElement>("#tour-next")!;
  const close = document.querySelector<HTMLButtonElement>("#tour-close")!;

  let steps: TourStep[] = [];
  let index = 0;
  let running = false;
  let target: HTMLElement | null = null;
  let locator: UiLocator | null = null;
  /** Bumped on every step change, so a slow answer for an abandoned step is discarded. */
  let generation = 0;
  /** A machine with no working model fails identically on all ten steps; say so once. */
  let reported = false;

  function untarget(): void {
    target?.classList.remove("tour-target");
    target = null;
  }

  /**
   * Re-anchor and re-position. The user is expected to work the app underneath, and `render()`
   * replaces the whole `#app` subtree, so the element the arrow points at is routinely
   * destroyed and rebuilt mid-step: the locator finds its replacement.
   */
  function place(): void {
    const found = target?.isConnected && visible(target)
      ? target
      : locator
        ? resolveLocator(locator)
        : null;
    if (found !== target) {
      untarget();
      target = found;
    }
    const box = tip.getBoundingClientRect();
    const view = { width: window.innerWidth, height: window.innerHeight };
    if (!target) {
      tip.dataset.side = "none";
      tip.style.top = `${Math.max(EDGE, view.height / 2 - box.height / 2)}px`;
      tip.style.left = `${Math.max(EDGE, view.width / 2 - box.width / 2)}px`;
      return;
    }
    target.classList.add("tour-target");
    const at = placeTip(target.getBoundingClientRect(), { width: box.width, height: box.height }, view);
    tip.dataset.side = at.side;
    tip.style.top = `${at.top}px`;
    tip.style.left = `${at.left}px`;
    if (at.side === "left" || at.side === "right") {
      arrow.style.top = `${at.arrow - 6}px`;
      arrow.style.left = "";
    }
    else {
      arrow.style.left = `${at.arrow - 6}px`;
      arrow.style.top = "";
    }
  }

  // ponytail: one getBoundingClientRect per frame while the tour is open, which is nothing next
  // to the app's own renders. Swap for scroll/resize listeners plus a MutationObserver if it
  // ever shows up in a profile.
  function loop(): void {
    if (!running)
      return;
    place();
    requestAnimationFrame(loop);
  }

  async function showStep(): Promise<void> {
    const step = steps[index];
    if (!step) {
      stop();
      return;
    }
    const mine = ++generation;
    untarget();
    locator = null;
    progress.textContent = `Step ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    body.innerHTML = renderMarkdown(step.body);
    next.textContent = index === steps.length - 1 ? "Done" : "Next";
    // Locating is the one thing worth waiting on: pressing Next before the arrow lands would
    // skip a step the user never saw pointed at anything.
    next.disabled = true;
    try {
      const ref = await deps.locateStep(step, index, steps.length);
      if (!running || mine !== generation)
        return;
      const element = ref ? deps.refElement(ref) : null;
      locator = element ? locatorFor(element) : null;
      // Only after the locator resolves against the live page — the snapshot's element may
      // already have been replaced by a render that happened while the model was thinking.
      const live = locator ? resolveLocator(locator) : null;
      live?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    catch (error) {
      // A tour whose model is unreachable still reads correctly; it just cannot point. That is
      // the common case for the exact user this feature is for, so it degrades instead of stopping.
      if (running && mine === generation && !reported) {
        reported = true;
        deps.onError(`The wizard cannot point at controls right now: ${errorText(error)}`);
      }
    }
    finally {
      if (running && mine === generation)
        next.disabled = false;
    }
  }

  async function start(): Promise<void> {
    stop();
    const loaded = await deps.loadSteps();
    if (!loaded.length) {
      deps.onError("The onboarding wizard has no steps yet — add one in Workspace settings → Onboarding.");
      return;
    }
    steps = loaded;
    index = 0;
    running = true;
    reported = false;
    root.hidden = false;
    // Started before the positioning loop so the first frame already has the step's text in it:
    // showStep fills the card synchronously and only then waits on the model.
    const first = showStep();
    loop();
    await first;
  }

  function stop(): void {
    running = false;
    generation += 1;
    untarget();
    locator = null;
    root.hidden = true;
  }

  next.addEventListener("click", () => {
    if (index >= steps.length - 1) {
      stop();
      return;
    }
    index += 1;
    void showStep();
  });

  close.addEventListener("click", stop);

  return {
    start,
    stop,
    get running() {
      return running;
    }
  };
}

/**
 * What ships before an administrator writes their own. Deliberately about the parts of Bees a
 * new install is useless without — a model, a team, a workflow, a run — rather than a feature tour.
 */
export const DEFAULT_TOUR = `# Bees onboarding

## Welcome to Bees
Bees runs work through **processes**: a work item moves along a row of statuses, and an agent
bound to a status starts by itself when an item lands there.

This wizard walks the setup in order. Do each step in the app — the tooltip stays out of your
way — then press **Next**.

Target: the Overview item in the left menu

## Open Settings
Everything that belongs to *this computer and this person* lives here: models, API keys,
sign-ins, and the root folder. None of it syncs.

Open it now.

Target: the Settings gear beside the Bees.bot name

## Turn on at least one model
An agent cannot run without a model it can reach, and skipping this is where almost every
"nothing happens when I press Run" comes from. Pick whichever you already have:

- **AI CLI** — connected Codex, plus Claude Code when you explicitly choose its binary.
- **Local AI** — download an on-device model, then Run it. No network, no bill.
- **AI APIs** — a provider key.

Target: the AI CLI tab in Settings

## Pick where files live
Every workspace and team folder is created under one root, \`<home>/Bees\` unless you change
it. Agents never see the rest of your disk.

Target: the Root Folder tab in Settings

## Add a team
A team is where the work actually lives — its processes, boards, tasks, agents, and one folder
on disk. Add one now.

Target: the + button beside Teams in the left menu

## Install a process
**Goals** plans a goal into subtasks, works them one at a time and reviews them. **Code** runs
requirements through to review against a Git project. Either is a better first run than a
process you design from scratch.

Target: the Processes button on the team row

## Add your first task
The title is the goal. The description is the acceptance criteria, and it is the only thing a
reviewing agent has to judge the result against later — so write it properly.

Target: the New task button on the team row

## Press Run, then watch Tasks waiting on you
**Run** starts the *process*, not one task: from then on every item landing on a status with
an agent starts itself. Anything needing a person — an approval, a rejected file, a stuck run —
collects under Tasks waiting on you.

Target: the Tasks waiting on you item under the team

## Or just ask
The **Assistant** takes plain language and proposes processes, statuses, agents and tasks as
cards you read first. Nothing is written until you press Apply.

That is the whole setup. Reopen this wizard any time from **Guided tour** at the bottom of the
left menu.

Target: the Assistant button in the top toolbar
`;

import type { BeesUiCommand } from "./assistant.js";

interface UiRef {
  element: HTMLElement;
  name: string;
}

const refs = new Map<string, UiRef>();

function compact(value: string, limit = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function visible(element: HTMLElement): boolean {
  // #tour is the onboarding wizard's own tooltip: it must never become a thing the model
  // clicks, nor a control it points its own arrow at.
  if (element.closest("#assistant,#tour,[hidden],[aria-hidden='true']")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

function controlName(element: HTMLElement): string {
  const input = element as HTMLInputElement;
  const labelled = "labels" in input ? input.labels?.[0]?.innerText : "";
  const name = [
    element.getAttribute("aria-label"),
    labelled,
    // textContent covers the detached case: the tour names an element the model chose, and a
    // re-render may already have pulled it out of the document, where innerText reads empty.
    element.innerText || element.textContent,
    element.getAttribute("title"),
    input.placeholder,
    input.name
  ].find((value) => value?.trim());
  return compact(name ?? element.tagName.toLowerCase());
}

function controlLine(ref: string, element: HTMLElement, name: string): string {
  const input = element as HTMLInputElement;
  const role =
    element instanceof HTMLInputElement
      ? input.type || "input"
      : element.tagName.toLowerCase();
  const metadata = [
    ["action", element.dataset.action],
    ["view", element.dataset.view],
    ["settings-tab", element.dataset.settingsTab],
    ["organization-tab", element.dataset.orgTab],
    ["team-tab", element.dataset.teamTab],
    ["model", element.dataset.model],
    ["model-toggle", element.dataset.modelToggle]
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.type !== "password" &&
    element.type !== "file"
  ) {
    metadata.push(`value=${JSON.stringify(compact(element.value, 100))}`);
  }
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
    metadata.push(`checked=${element.checked}`);
  }
  if (element instanceof HTMLSelectElement) {
    metadata.push(`value=${JSON.stringify(element.value)}`);
    metadata.push(
      `options=${JSON.stringify([...element.options].map(({ value, text }) => ({ value, text })))}`
    );
  }
  const row = element.closest<HTMLElement>("tr,li");
  const context = row ? compact(row.innerText, 140) : "";
  return `${ref} ${role} ${JSON.stringify(name)}${metadata.length ? ` [${metadata.join(", ")}]` : ""}${
    context && context !== name ? ` — ${context}` : ""
  }`;
}

/**
 * A compact accessibility-style view of the live Bees window. Refs are opaque and valid only
 * until the next snapshot, so the model cannot manufacture selectors or reach hidden controls.
 */
export function snapshotBeesUi(): string {
  refs.clear();
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  const scope: ParentNode = dialog ?? document.body;
  const controls = [
    ...scope.querySelectorAll<HTMLElement>(
      "button,input:not([type='hidden']),textarea,select,a[href],[role='button']"
    )
  ].filter((element) => visible(element) && !element.hasAttribute("disabled"));
  const lines: string[] = [];
  for (const [index, element] of controls.slice(0, 120).entries()) {
    const ref = `u${index + 1}`;
    const name = controlName(element);
    refs.set(ref, { element, name });
    lines.push(controlLine(ref, element, name));
  }

  const title = compact(
    dialog?.querySelector<HTMLElement>("h1,h2,h3")?.innerText ??
      document.querySelector<HTMLElement>("#view-title")?.innerText ??
      "Bees"
  );
  const textRoot = dialog ?? document.querySelector<HTMLElement>("#app");
  const text = compact(textRoot?.innerText ?? "", 2_500);
  const result = [`Screen: ${title}`, text ? `Visible text: ${text}` : "", "Controls:", ...lines]
    .filter(Boolean)
    .join("\n");
  return result.length > 8_000 ? `${result.slice(0, 8_000)}\n…[snapshot truncated]` : result;
}

/**
 * The element behind a ref, connected or not. `current` below is the strict version the
 * assistant's own commands need; this one exists for the tour, which only wants to read the
 * element's identity and immediately turns it into a `UiLocator`.
 */
export function refElement(ref: string): HTMLElement | null {
  return refs.get(ref)?.element ?? null;
}

/**
 * A ref survives until the next snapshot; a tour step has to survive the user working the page
 * underneath it, and `render()` replaces the whole `#app` subtree on every click. So the tour
 * keeps a locator instead of an element, and re-finds the replacement each frame.
 */
export interface UiLocator {
  selector: string;
  name: string;
}

/** Attributes the app already uses to say what a control *is*, most specific first. */
const LOCATOR_ATTRIBUTES = [
  "data-view",
  "data-action",
  "data-settings-tab",
  "data-org-tab",
  "data-team-tab",
  "data-team-view",
  "data-board",
  "data-theme-preset",
  "data-branding",
  "data-model"
];

export function locatorFor(element: HTMLElement): UiLocator {
  const name = controlName(element);
  if (element.id) return { selector: `#${CSS.escape(element.id)}`, name };
  const selector = LOCATOR_ATTRIBUTES.filter((attribute) => element.getAttribute(attribute))
    .map((attribute) => `[${attribute}=${JSON.stringify(element.getAttribute(attribute))}]`)
    .join("");
  return { selector: selector || element.tagName.toLowerCase(), name };
}

/**
 * Selector first, then the accessible name as a tiebreak — several rows can carry the same
 * `data-action`. A control with no distinguishing attribute at all falls back to the name
 * alone, which is how "the Rename button" keeps working across a re-render.
 */
export function resolveLocator({ selector, name }: UiLocator): HTMLElement | null {
  let matches: HTMLElement[] = [];
  try {
    matches = [...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
  }
  catch {
    matches = [];
  }
  const named = matches.find((element) => controlName(element) === name);
  if (named) return named;
  if (matches.length) return matches[0]!;
  return (
    [...document.querySelectorAll<HTMLElement>("button,input:not([type='hidden']),textarea,select,a[href],[role='button']")]
      .filter(visible)
      .find((element) => controlName(element) === name) ?? null
  );
}

function current(ref: string): UiRef {
  const target = refs.get(ref);
  if (!target) throw new Error(`Unknown UI ref ${ref}; observe the latest snapshot`);
  if (!target.element.isConnected || !visible(target.element)) {
    throw new Error(`UI ref ${ref} is stale; observe the latest snapshot`);
  }
  return target;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Executes one already-approved command against a visible Bees control. */
export async function executeBeesUiCommand(command: BeesUiCommand): Promise<string> {
  if (command.op === "wait") {
    await pause(command.milliseconds);
    return `Waited ${command.milliseconds} ms`;
  }
  if (command.op === "finish") return command.message;

  const target = current(command.ref);
  const { element, name } = target;
  if (
    element.dataset.action === "open-external" ||
    element.dataset.action === "connect-site" ||
    (element instanceof HTMLAnchorElement && /^https?:/i.test(element.href))
  ) {
    throw new Error("The Bees assistant cannot open or operate external sites");
  }

  if (command.op === "click") {
    if (element instanceof HTMLInputElement && element.type === "file") {
      throw new Error("File pickers require the user");
    }
    element.click();
    await pause(250);
    return `Clicked ${name}`;
  }

  if (command.op === "fill") {
    if (
      !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
      element.type === "file" ||
      element.type === "password"
    ) {
      throw new Error(`${name} is not a fillable text control`);
    }
    element.value = command.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(50);
    return `Filled ${name}`;
  }

  if (command.op === "select") {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${name} is not a select control`);
    }
    if (![...element.options].some(({ value }) => value === command.value)) {
      throw new Error(`${JSON.stringify(command.value)} is not an option for ${name}`);
    }
    element.value = command.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(100);
    return `Selected ${name}`;
  }

  if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) {
    throw new Error(`${name} is not a toggle`);
  }
  if (element.checked !== command.checked) element.click();
  await pause(250);
  return `${command.checked ? "Enabled" : "Disabled"} ${name}`;
}

import { defineTool } from "@flue/runtime/tool";
import type { ToolDefinition } from "@flue/runtime/tool";
import { chromium } from "playwright-core";
import type { BrowserContext, Page } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as v from "valibot";
import { instancePointer, stateDir } from "./state.ts";

// A real Chrome window the agent drives. Uses the user's *installed* Chrome
// (channel: "chrome") so sites see a genuine fingerprint, but a dedicated
// per-workspace profile dir — never the user's personal Chrome profile. Cookies,
// sessions and (if the user opts in) Chrome's own saved passwords persist in that
// dir, so login is a one-time thing per site. Bees never reads or stores any of it.

const contexts = new Map<string, Promise<BrowserContext>>();

// Per-workspace profile dir, keyed by a stable hash of the *team folder* (teamRoot).
// teamRoot is stable across runs (unlike the per-run temp workspace), so a login the
// user did once — whether mid-run or via the "connect a site" button — is reused by
// every later run for that team.
function profileDirForKey(profileKey: string): string {
  const key = createHash("sha1").update(profileKey).digest("hex").slice(0, 16);
  return resolve(stateDir(), "browser-profiles", key);
}

// A run's tools only know the instance id; resolve its stable profile key from the
// instance pointer. Falls back to the workspace path for older pointers without teamRoot.
async function profileKeyForInstance(instanceId: string): Promise<string> {
  const parsed = JSON.parse(await readFile(instancePointer(instanceId), "utf8")) as {
    teamRoot?: string;
    workspace: string;
  };
  return parsed.teamRoot ?? parsed.workspace;
}

async function getContext(dir: string): Promise<BrowserContext> {
  const cached = contexts.get(dir);
  if (cached) return cached;
  // ponytail: single shared context per profile dir. Chrome locks the dir, so one
  // window per workspace at a time — matches the per-workspace-profile decision.
  const opening = (async () => {
    await mkdir(dir, { recursive: true });
    try {
      return await chromium.launchPersistentContext(dir, {
        channel: "chrome",
        headless: false,
        viewport: null
      });
    } catch (error) {
      contexts.delete(dir);
      throw new Error(
        `Could not launch Google Chrome. Install Chrome and try again. (${(error as Error).message})`
      );
    }
  })();
  contexts.set(dir, opening);
  return opening;
}

// One tab per owner, not one tab per team. Runs for a team share the profile (that is the
// point — logins persist), but they must not share a tab: two concurrent runs on page 0
// navigate each other's page out from under the model between tool calls.
const pages = new Map<string, Promise<Page>>();

// ponytail: LRU cap instead of run-lifecycle teardown, because a tool has no run-end hook.
// Give browser.ts a close(instanceId) call if runs ever need their tab gone on settlement.
const MAX_PAGES = 8;

async function getPageForKey(profileKey: string, owner: string): Promise<Page> {
  const key = `${profileKey}::${owner}`;
  const cached = pages.get(key);
  if (cached) {
    const page = await cached.catch(() => null);
    if (page && !page.isClosed()) {
      // Re-insert so the map stays in least-recently-used order.
      pages.delete(key);
      pages.set(key, cached);
      return page;
    }
    pages.delete(key);
  }
  const opening = getContext(profileDirForKey(profileKey)).then(async (context) => {
    // Reuse the window's existing blank tab for the first owner rather than leaving it empty.
    const blank = context.pages().find((page) => page.url() === "about:blank");
    return blank && !pages.size ? blank : context.newPage();
  });
  pages.set(key, opening);
  for (const [stale] of [...pages].slice(0, Math.max(0, pages.size - MAX_PAGES))) {
    pages.get(stale)?.then((page) => page.close()).catch(() => {});
    pages.delete(stale);
  }
  return opening;
}

async function getPage(instanceId: string): Promise<Page> {
  return getPageForKey(await profileKeyForInstance(instanceId), instanceId);
}

// Used by the UI "connect a site" button (via the /browser/open route): open the
// team's Chrome window at a URL so the user can log in manually, no run involved.
export async function openSite(profileKey: string, url: string): Promise<{ url: string; title: string }> {
  const page = await getPageForKey(profileKey, "manual");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => {});
  return { url: page.url(), title: await page.title() };
}

// Close windows when the runtime shuts down. The profile persists on disk either way.
process.once("beforeExit", () => {
  for (const opening of contexts.values()) opening.then((context) => context.close()).catch(() => {});
});

const MAX_TEXT = 6000;

async function pageText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated]` : text;
}

export function browserTools(instanceId: string, allowWrite = true): ToolDefinition[] {
  const readTools: ToolDefinition[] = [
    defineTool({
      name: "browser_navigate",
      description:
        "Open or navigate the workspace's Chrome window to a URL. Returns the page title, final URL and visible text.",
      input: v.object({ url: v.string() }),
      async run({ data }) {
        const page = await getPage(instanceId);
        await page.goto(data.url, { waitUntil: "domcontentloaded" });
        return { output: { title: await page.title(), url: page.url(), text: await pageText(page) } };
      }
    }),
    defineTool({
      name: "browser_read",
      description: "Return the visible text of the current page. Use to see what's on screen.",
      async run() {
        const page = await getPage(instanceId);
        return { output: { url: page.url(), title: await page.title(), text: await pageText(page) } };
      }
    }),
    defineTool({
      name: "browser_wait_for_login",
      description:
        "Pause and let the user log in manually in the Chrome window. Bees never handles the password. " +
        "Provide `successSelector` or `successText` that appears once logged in; resolves when it shows or times out.",
      input: v.object({
        successSelector: v.optional(v.string()),
        successText: v.optional(v.string()),
        timeoutMs: v.optional(v.number())
      }),
      async run({ data }) {
        const page = await getPage(instanceId);
        const timeout = data.timeoutMs ?? 300000;
        try {
          if (data.successSelector) await page.waitForSelector(data.successSelector, { timeout });
          else if (data.successText) await page.getByText(data.successText, { exact: false }).first().waitFor({ timeout });
          else await page.waitForTimeout(Math.min(timeout, 60000));
          return { output: { loggedIn: true, url: page.url() } };
        } catch {
          return { output: { loggedIn: false, url: page.url(), note: "Login not detected before timeout." } };
        }
      }
    }),
    defineTool({
      name: "browser_screenshot",
      description: "Save a PNG screenshot of the current page to the profile dir. Returns the file path.",
      async run() {
        const page = await getPage(instanceId);
        const path = resolve(profileDirForKey(await profileKeyForInstance(instanceId)), "screenshots", `${Date.now()}.png`);
        await mkdir(resolve(path, ".."), { recursive: true });
        await page.screenshot({ path, fullPage: false });
        return { output: { path } };
      }
    })
  ];
  if (!allowWrite) return readTools;
  return [
    ...readTools,
    defineTool({
      name: "browser_click",
      description:
        "Click an element. Give either `text` (visible label, preferred) or a CSS `selector`.",
      input: v.object({ text: v.optional(v.string()), selector: v.optional(v.string()) }),
      async run({ data }) {
        const page = await getPage(instanceId);
        if (data.selector) await page.click(data.selector, { timeout: 15000 });
        else if (data.text) await page.getByText(data.text, { exact: false }).first().click({ timeout: 15000 });
        else throw new Error("browser_click needs `text` or `selector`");
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return { output: { url: page.url(), title: await page.title(), text: await pageText(page) } };
      }
    }),

    defineTool({
      name: "browser_type",
      description:
        "Type text into a field matched by CSS `selector`. Set `submit` to press Enter after (e.g. to search).",
      input: v.object({ selector: v.string(), text: v.string(), submit: v.optional(v.boolean()) }),
      async run({ data }) {
        const page = await getPage(instanceId);
        await page.fill(data.selector, data.text, { timeout: 15000 });
        if (data.submit) {
          await page.press(data.selector, "Enter");
          await page.waitForLoadState("domcontentloaded").catch(() => {});
        }
        return { output: { url: page.url(), title: await page.title() } };
      }
    })
  ];
}

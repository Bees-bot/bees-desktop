import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { defineTool } from "@deepseek-ai/dsh-tools";

const contexts = new Map();
const pages = new Map();
const visibleProfiles = new Set();
const stateRoot = process.env.BEES_STATE_DIR ?? process.cwd();

function profileDirectory(key) {
  return resolve(stateRoot, "browser-profiles", createHash("sha256").update(key).digest("hex").slice(0, 24));
}

async function profileKey(executionId) {
  const pointer = JSON.parse(await readFile(resolve(stateRoot, "instances", `${executionId}.json`), "utf8"));
  return pointer.teamRoot ?? pointer.workspace;
}

async function windowState(page, value) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: value } });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function contextFor(directory) {
  if (contexts.has(directory)) return contexts.get(directory);
  const opening = (async () => {
    await mkdir(directory, { recursive: true });
    try {
      const context = await chromium.launchPersistentContext(directory, {
        channel: "chrome",
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled", "--start-minimized"]
      });
      context.on("close", () => {
        contexts.delete(directory);
        visibleProfiles.delete(directory);
        for (const key of pages.keys()) if (key.startsWith(`${directory}::`)) pages.delete(key);
      });
      const page = context.pages()[0] ?? await context.newPage();
      await windowState(page, "minimized").catch(() => undefined);
      return context;
    } catch (error) {
      contexts.delete(directory);
      throw new Error(`Could not launch Google Chrome. Install Chrome and try again. (${error.message})`);
    }
  })();
  contexts.set(directory, opening);
  return opening;
}

async function pageForKey(key, owner) {
  const directory = profileDirectory(key);
  const pageKey = `${directory}::${owner}`;
  const existing = pages.get(pageKey);
  if (existing) {
    const page = await existing.catch(() => null);
    if (page && !page.isClosed()) return page;
    pages.delete(pageKey);
  }
  const opening = contextFor(directory).then(async (context) => {
    const blank = context.pages().find((page) => page.url() === "about:blank");
    const alreadyOwned = [...pages.keys()].some((candidate) => candidate.startsWith(`${directory}::`));
    return blank && !alreadyOwned ? blank : context.newPage();
  });
  pages.set(pageKey, opening);
  while (pages.size > 8) {
    const oldest = pages.keys().next().value;
    pages.get(oldest)?.then((page) => page.close()).catch(() => undefined);
    pages.delete(oldest);
  }
  return opening;
}

async function pageFor(executionId) {
  return pageForKey(await profileKey(executionId), executionId);
}

async function navigate(page, value) {
  const url = new URL(value, page.url());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs may be opened");
  if (url.href.split("#")[0] === page.url().split("#")[0]) {
    await page.evaluate((href) => { window.location.href = href; }, url.href);
  } else {
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
  }
}

async function snapshot(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  const raw = await page.evaluate(() => document.body?.innerText ?? "");
  return {
    url: page.url(),
    title: await page.title(),
    text: raw.length > 8_000 ? `${raw.slice(0, 8_000)}\n…[truncated]` : raw
  };
}

const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render(_args, value) {
    return [{ type: "text", text: JSON.stringify(value, null, 2) }];
  }
};

export function browserTools(executionId, allowWrite) {
  const tools = [
    defineTool({
      name: "browser_navigate",
      description: "Navigate the dedicated Bees Chrome profile to an HTTP(S) URL and read the visible page.",
      parameters: { url: { type: "string", required: true } },
      output: objectOutput,
      async execute({ url }) {
        const page = await pageFor(executionId);
        await navigate(page, url);
        return snapshot(page);
      }
    }),
    defineTool({
      name: "browser_read",
      description: "Read the title, URL, and visible text of the current browser page.",
      parameters: {},
      output: objectOutput,
      async execute() { return snapshot(await pageFor(executionId)); }
    }),
    defineTool({
      name: "browser_wait_for_login",
      description: "Show Chrome so the user can log in themselves; Bees never receives a password.",
      parameters: {
        successSelector: { type: "string" },
        successText: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      output: objectOutput,
      async execute({ successSelector, successText, timeoutMs }) {
        const key = await profileKey(executionId);
        const page = await pageForKey(key, executionId);
        const directory = profileDirectory(key);
        await windowState(page, "normal");
        await page.bringToFront();
        const timeout = Math.min(Math.max(timeoutMs ?? 300_000, 1_000), 600_000);
        let loggedIn = true;
        try {
          if (successSelector) await page.waitForSelector(successSelector, { timeout });
          else if (successText) await page.getByText(successText, { exact: false }).first().waitFor({ timeout });
          else await page.waitForTimeout(Math.min(timeout, 60_000));
        } catch {
          loggedIn = false;
        } finally {
          if (!visibleProfiles.has(directory)) await windowState(page, "minimized").catch(() => undefined);
        }
        return { loggedIn, url: page.url() };
      }
    })
  ];
  if (!allowWrite) return tools;
  tools.push(
    defineTool({
      name: "browser_click",
      description: "Click a visible page element by label or CSS selector.",
      parameters: { text: { type: "string" }, selector: { type: "string" } },
      output: objectOutput,
      async execute({ text, selector }) {
        const page = await pageFor(executionId);
        if (selector) await page.click(selector, { timeout: 15_000 });
        else if (text) await page.getByText(text, { exact: false }).locator("visible=true").first().click({ timeout: 15_000 });
        else throw new Error("browser_click needs text or selector");
        return snapshot(page);
      }
    }),
    defineTool({
      name: "browser_type",
      description: "Fill a page field selected by CSS and optionally submit it with Enter.",
      parameters: {
        selector: { type: "string", required: true },
        text: { type: "string", required: true },
        submit: { type: "boolean" }
      },
      output: objectOutput,
      async execute({ selector, text, submit }) {
        const page = await pageFor(executionId);
        await page.fill(selector, text, { timeout: 15_000 });
        if (submit) await page.press(selector, "Enter");
        return { url: page.url(), title: await page.title() };
      }
    })
  );
  return tools;
}

export async function openSite(key, url) {
  const page = await pageForKey(key, "manual");
  await navigate(page, url);
  visibleProfiles.add(profileDirectory(key));
  await windowState(page, "normal");
  await page.bringToFront();
  return { url: page.url(), title: await page.title() };
}

export async function showExecution(executionId, lastUrl) {
  const key = await profileKey(executionId);
  const page = await pageForKey(key, executionId);
  if (page.url() === "about:blank" && lastUrl) await navigate(page, lastUrl);
  visibleProfiles.add(profileDirectory(key));
  await windowState(page, "normal");
  await page.bringToFront();
  return { url: page.url(), title: await page.title() };
}

process.once("beforeExit", () => {
  for (const opening of contexts.values()) opening.then((context) => context.close()).catch(() => undefined);
});

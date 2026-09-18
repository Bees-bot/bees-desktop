import { expect, it, vi } from "vitest";
// @ts-expect-error Plain JS runtime boundary.
import { mountPageFetch } from "../dsh-runtime/plugin/lib/web-page.js";

it("preserves publication metadata from Google and Yahoo feeds, separately from retrieval time", async () => {
  const registered = new Map<string, any>();
  const xml = `<rss><channel><item><title><![CDATA[Lyft &amp; markets]]></title>
    <link>https://finance.yahoo.com/story?a=1&amp;b=2</link><pubDate>2026-09-10T17:13:16Z</pubDate>
    <source url="https://publisher.example">The Publisher</source><description>Shares rose after earnings.</description></item>
    <item><title>No exposed date</title><link>https://example.com/undated</link></item></channel></rss>`;
  const fetch = vi.fn(async ({ url }) => ({ url, statusCode: 200, body: { kind: "text", content: xml } }));
  mountPageFetch({ tools: { register: (tool: any) => registered.set(tool.name, tool) } }, { fetch });
  const exec = { signal: new AbortController().signal };
  for (const [name, args, field] of [
    ["bees_search_news", { query: "business when:1d" }, "headlines"],
    ["bees_fetch_page", { url: "https://finance.yahoo.com/rss/" }, "page"]
  ] as const) {
    const result = await registered.get(name).execute(args, exec);
    expect(result[field]).toContain('"published_at":"2026-09-10T17:13:16Z"');
    expect(result[field]).toContain('"publisher":"The Publisher"');
    expect(result[field]).toContain('"title":"Lyft & markets"');
    expect(result[field]).toContain('"url":"https://finance.yahoo.com/story?a=1&b=2"');
    expect(result[field]).toContain('"published_at":null');
    expect(result[field]).toContain('"description":"Shares rose after earnings."');
  }
});

it("marks page truncation explicitly", async () => {
  const registered = new Map<string, any>();
  mountPageFetch({ tools: { register: (tool: any) => registered.set(tool.name, tool) } }, {
    fetch: async ({ url }: any) => ({ url, statusCode: 200, body: { kind: "text", content: "x".repeat(21_000) } })
  });
  const result = await registered.get("bees_fetch_page").execute({ url: "https://example.com/" }, {});
  expect(result.page).toContain("1000 characters omitted from the middle");
});

it.each(["https://example.com/", "https://www.example.com/"])("preserves redirect failures without retrying %s", async (url) => {
  const registered = new Map<string, any>();
  const error = Object.assign(new Error("Cross-origin redirect blocked"), { code: "WEB_REDIRECT_BLOCKED" });
  const fetch = vi.fn().mockRejectedValue(error);
  mountPageFetch({ tools: { register: (tool: any) => registered.set(tool.name, tool) } }, { fetch });
  const signal = new AbortController().signal;
  await expect(registered.get("bees_fetch_page").execute({ url }, { signal })).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledExactlyOnceWith({ url }, signal);
});

import assert from "node:assert/strict";
import { mountPageFetch } from "../dsh-runtime/plugin/lib/web-page.js";
import { mountRepeatGuard } from "../dsh-runtime/plugin/lib/repeat-guard.js";

const owner = {};
const hooks = new Map();
const registered = new Map();
const agentCtx = {
  on: (event, handler) => hooks.set(event, handler),
  tools: { register: (tool) => registered.set(tool.name, tool) }
};
let statusCode = 404;
let requests = 0;
const web = { fetch: async ({ url }) => {
  requests++;
  return { url, statusCode, body: { kind: "html", content: "<html><body>Page content</body></html>" } };
} };
mountRepeatGuard(agentCtx, owner);
mountPageFetch(agentCtx, web);
const tool = registered.get("bees_fetch_page");
const url = "https://bees.bot/blog/ai-agents-automation-automation-automation-automation-automation-aut";

// Missing pages must fail, so the existing guard sees them, and never refetch.
for (let attempt = 0; attempt < 10; attempt++) {
  const exec = { agent: owner, name: tool.name, arguments: { url } };
  await hooks.get("tools/execute")(exec, () => {});
  await assert.rejects(tool.execute(exec.arguments, exec), (error) => {
    assert.match(error.message, /HTTP 404/);
    assert.match(error.message, /Do not fetch this URL again/);
    assert.doesNotMatch(error.message, /Page content|JavaScript/);
    hooks.get("tools/result")(exec, { isError: true, error });
    return true;
  });
}
assert.equal(requests, 1);
assert.equal((await hooks.get("tools/pre-execute")(
  { agent: owner, name: tool.name, arguments: { url } }, () => ({ kind: "allow" })
)).kind, "deny");
await assert.rejects(tool.execute({ url: `${url}#section` }, {}), /HTTP 404/);
assert.equal(requests, 1, "fragments must not bypass the missing-page cache");

statusCode = 410;
for (let attempt = 0; attempt < 2; attempt++) {
  await assert.rejects(tool.execute({ url: `${url}/gone` }, {}), /HTTP 410/);
}
assert.equal(requests, 2);

for (const status of [403, 429, 503]) {
  statusCode = status;
  await assert.rejects(tool.execute({ url: `${url}/other` }, {}), new RegExp(`HTTP ${status}`));
}
statusCode = 200;
assert.match((await tool.execute({ url: `${url}/other` }, {})).page, /Page content/);
assert.equal(requests, 6, "other HTTP failures must remain retryable");

// A fresh agent can see a page that has since been published.
mountPageFetch(agentCtx, web);
assert.match((await registered.get(tool.name).execute({ url }, {})).page, /HTTP 200/);
assert.equal(requests, 7);
console.log("Page fetch regression check passed");

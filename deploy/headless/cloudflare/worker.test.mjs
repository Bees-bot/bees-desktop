import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Replace only the platform superclass; exercise the actual Worker and DO methods.
const base = "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx) { this.ctx = ctx; } }");
const source = (await readFile(new URL("./worker.mjs", import.meta.url), "utf8"))
  .replace('"cloudflare:workers"', JSON.stringify(base));
const { default: worker, BeesProof } = await import("data:text/javascript," + encodeURIComponent(source));

test("private proof refuses unauthenticated provisioning and runs only the fixed synthetic command", async () => {
  const token = "a".repeat(64);
  let routed = 0, destroyed = 0;
  const env = { BEES_PROOF_TOKEN: token, PROOF: { getByName(name) {
    assert.equal(name, "stage1-proof"); routed++; return { fetch: async () => new Response("ok") };
  } } };
  const request = (path = "/proof", method = "POST", offered = token) => new Request(`https://proof.example${path}`,
    { method, headers: { authorization: `Bearer ${offered}` } });
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(request("/proof", "POST", "bad"), env)).status, 401);
  assert.equal((await worker.fetch(request("/unknown"), env)).status, 404);
  assert.equal((await worker.fetch(request("/proof", "GET"), env)).status, 405);
  assert.equal(routed, 0);
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(routed, 1);
  let exitCode = 0;
  const gate = Promise.withResolvers();
  const proof = new BeesProof({ container: {
    start(options) { assert.deepEqual(options, { entrypoint: ["sleep", "infinity"], enableInternet: false }); },
    async setInactivityTimeout(ms) { assert.equal(ms, 600_000); },
    async exec(command, options) {
      assert.deepEqual(command, ["timeout", "360", "node", "scripts/check-headless.mjs"]);
      assert.deepEqual(options, { cwd: "/opt/bees" });
      return { async output() { await gate.promise; return { exitCode, stdout: new TextEncoder().encode('{"ok":true}\n') }; } };
    },
    async destroy() { destroyed++; }
  } });
  const first = proof.fetch();
  assert.equal((await proof.fetch()).status, 409);
  gate.resolve();
  assert.deepEqual(await (await first).json(), { ok: true });
  assert.equal(destroyed, 1);
  exitCode = 1;
  assert.equal((await proof.fetch()).status, 502);
  assert.equal(destroyed, 2);
});

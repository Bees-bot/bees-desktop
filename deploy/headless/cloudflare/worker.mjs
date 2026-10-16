import { DurableObject } from "cloudflare:workers";

// A single private compatibility test, not the SaaS control plane or a tenant router.
export class BeesProof extends DurableObject {
  pending = false;

  async fetch() {
    if (this.pending) return new Response("Proof already running", { status: 409 });
    this.pending = true;
    const container = this.ctx.container;
    try {
      container.start({ entrypoint: ["sleep", "infinity"], enableInternet: false });
      await container.setInactivityTimeout(600_000);
      const process = await container.exec(["timeout", "360", "node", "scripts/check-headless.mjs"], { cwd: "/opt/bees" });
      const output = await process.output();
      const line = new TextDecoder().decode(output.stdout).trim().split("\n").at(-1);
      if (output.exitCode !== 0) return Response.json({ ok: false, exitCode: output.exitCode }, { status: 502 });
      const result = JSON.parse(line);
      if (result.ok !== true) throw new Error("No successful proof result");
      return Response.json(result);
    } catch {
      return Response.json({ ok: false, error: "Cloud compatibility proof failed; inspect container logs" }, { status: 502 });
    } finally {
      try { await container.destroy(); } finally { this.pending = false; }
    }
  }
}

export default {
  async fetch(request, env) {
    if (typeof env.BEES_PROOF_TOKEN !== "string" || env.BEES_PROOF_TOKEN.length < 32)
      return new Response("Proof token is not configured", { status: 503 });
    const expected = `Bearer ${env.BEES_PROOF_TOKEN}`;
    const offered = request.headers.get("authorization") || "";
    const hash = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([hash(expected), hash(offered)]);
    let different = 0;
    for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
    if (different) return new Response("Unauthorized", { status: 401 });
    if (new URL(request.url).pathname !== "/proof") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Use POST", { status: 405 });
    return env.PROOF.getByName("stage1-proof").fetch(request);
  }
};

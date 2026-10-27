import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, launchConfig } from "./headless.mjs";

// one command for headless Bees on your tailnet: keeps a token, serves it on :8443, prints the sign-in link
const stateDir = join(homedir(), ".bees-headless"), port = 8090, tokenFile = join(stateDir, "phone-token");
const tailscale = (...args) => execFileSync("tailscale", args, { encoding: "utf8" });
const controller = new AbortController();
for (const name of ["SIGTERM", "SIGINT"]) process.once(name, () => controller.abort());
try {
  const name = JSON.parse(tailscale("status", "--json")).Self.DNSName.replace(/\.$/, "");
  if (!name) throw new Error("Turn on MagicDNS in the Tailscale admin console first");
  if (JSON.parse(tailscale("serve", "status", "--json") || "{}").AllowFunnel?.[`${name}:8443`])
    throw new Error(`Port 8443 is public through tailscale funnel; run: tailscale funnel --https=8443 off`);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  let token = await readFile(tokenFile, "utf8").catch(() => "");
  if (!token) await writeFile(tokenFile, token = randomBytes(24).toString("hex"), { mode: 0o600 });
  const config = launchConfig({ stateDir, port, trustedHosts: [name] }, { BEES_DSH_TOKEN: token });
  tailscale("serve", "--bg", "--https=8443", String(port));
  console.log(`\nOpen this once on your phone:\nhttps://${name}:8443/bees-auth?token=${token}\n`);
  await launch(config, controller.signal);
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error.syscall === "spawnSync tailscale" ? "Install Tailscale and its tailscale command first" : error.message);
    process.exitCode = 1;
  }
}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, launchConfig } from "./headless.mjs";

// one command for headless Bees on your tailnet: keeps a token, serves it on :8443, prints the sign-in link
const stateDir = join(homedir(), ".bees-headless"), port = 8090, tokenFile = join(stateDir, "phone-token");
// some installs run tailscaled on a non-default socket, which the cli only finds through --socket
const socket = process.env.TAILSCALE_SOCKET ? [`--socket=${process.env.TAILSCALE_SOCKET}`] : [];
const tailscale = (...args) => execFileSync("tailscale", [...socket, ...args], { encoding: "utf8" });
const controller = new AbortController();
for (const name of ["SIGTERM", "SIGINT"]) process.once(name, () => controller.abort());
let serving = false;
try {
  const status = JSON.parse(tailscale("status", "--json"));
  if (status.BackendState !== "Running") throw new Error("Tailscale is not connected; run: tailscale up");
  const name = status.Self?.DNSName?.replace(/\.$/, "");
  if (!name) throw new Error("Turn on MagicDNS in the Tailscale admin console first");
  const served = JSON.parse(tailscale("serve", "status", "--json") || "{}");
  if (served.AllowFunnel?.[`${name}:8443`])
    throw new Error(`Port 8443 is public through tailscale funnel; run: tailscale funnel --https=8443 off`);
  // serve --bg silently replaces whatever 8443 already proxied
  const proxy = served.Web?.[`${name}:8443`]?.Handlers?.["/"]?.Proxy;
  if (served.TCP?.["8443"] && proxy !== `http://127.0.0.1:${port}`)
    throw new Error("Tailscale already serves something else on port 8443; free it with: tailscale serve --https=8443 off");
  // a busy port would send the phone, and its token, to some other program
  await new Promise((done, fail) => { const server = createServer().once("error", () => fail(new Error(`Port ${port} is already in use; stop that program first`))); server.listen(port, "127.0.0.1", () => server.close(done)); });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  let token = (await readFile(tokenFile, "utf8").catch(() => "")).trim();
  if (token.length < 32) await writeFile(tokenFile, token = randomBytes(24).toString("hex"));
  await chmod(tokenFile, 0o600);
  const config = launchConfig({ stateDir, port, trustedHosts: [name] }, { BEES_DSH_TOKEN: token });
  tailscale("serve", "--bg", "--https=8443", String(port));
  serving = true;
  console.log(`\nOpen this once on your phone:\nhttps://${name}:8443/bees-auth?token=${token}\n`);
  await launch(config, controller.signal);
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error.syscall === "spawnSync tailscale" ? "Install Tailscale and its tailscale command first" : error.message);
    process.exitCode = 1;
  }
} finally {
  if (serving) try { tailscale("serve", "--https=8443", "off"); } catch {}
}

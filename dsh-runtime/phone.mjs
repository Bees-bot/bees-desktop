import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, launchConfig } from "./headless.mjs";
import { share, unshare } from "./plugin/lib/tailnet.js";

// one command for headless Bees on your tailnet: keeps a token, serves it on :8443, prints the sign-in link
const stateDir = join(homedir(), ".bees-headless"), port = 8090, tokenFile = join(stateDir, "phone-token");
const controller = new AbortController();
for (const name of ["SIGTERM", "SIGINT"]) process.once(name, () => controller.abort());
let serving = false;
try {
  // a busy port would send the phone, and its token, to some other program
  await new Promise((done, fail) => { const server = createServer().once("error", () => fail(new Error(`Port ${port} is already in use; stop that program first`))); server.listen(port, "127.0.0.1", () => server.close(done)); });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  let token = (await readFile(tokenFile, "utf8").catch(() => "")).trim();
  if (token.length < 32) await writeFile(tokenFile, token = randomBytes(24).toString("hex"));
  await chmod(tokenFile, 0o600);
  const name = await share(port);
  serving = true;
  const config = launchConfig({ stateDir, port, trustedHosts: [name] }, { BEES_DSH_TOKEN: token });
  console.log(`\nOpen this once on your phone:\nhttps://${name}:8443/bees-auth?token=${token}\n`);
  await launch(config, controller.signal);
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  if (serving) await unshare().catch(() => {});
}

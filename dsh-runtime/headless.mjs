import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from "node:timers/promises";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";

const runtime = dirname(fileURLToPath(import.meta.url));
const profilePackages = [
  ...["dsh-plugin", "dsh-local-ai", "dsh-custom-ai", "dsh-subscriptions"].map((name) => `@bees/${name}`),
  ...["agent-team", "tool-agent-team", "client-ui-agent-team"].map((name) => `@deepseek-ai/dsh-experimental-${name}`)
];

export function launchConfig(config, env = process.env) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 7) throw new Error("Bees requires Node 24.7 or newer 24.x");
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Expected a JSON configuration object");
  const keys = ["stateDir", "host", "port", "temporalBinary"];
  if (Object.keys(config).some((key) => !keys.includes(key))) throw new Error(`Supported configuration: ${keys.join(", ")}`);
  if (typeof config.stateDir !== "string" || !isAbsolute(config.stateDir) || resolve(config.stateDir) === dirname(resolve(config.stateDir)))
    throw new Error("stateDir must be an absolute, dedicated directory, not a filesystem root");
  const host = config.host ?? "127.0.0.1", port = config.port ?? 8080;
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("host must be 127.0.0.1 or 0.0.0.0");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer from 1 to 65535");
  const token = env.BEES_DSH_TOKEN;
  if (typeof token !== "string" || token.length < 32 || /[\s\x00-\x1f\x7f]/.test(token))
    throw new Error("Set BEES_DSH_TOKEN to a random token of at least 32 characters, without whitespace");
  const temporalBinary = config.temporalBinary ?? "temporal";
  if (typeof temporalBinary !== "string" || !temporalBinary.trim()) throw new Error("temporalBinary must name an executable");
  return { stateDir: resolve(config.stateDir), host, port, temporalBinary, token };
}

async function createOnce(path, content) {
  try { await writeFile(path, content, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

async function prepareProfile(home) {
  const profile = join(home, "profiles", "bees");
  await mkdir(profile, { recursive: true });
  await copyFile(join(runtime, "profile", "package.json"), join(profile, "package.json"));
  await createOnce(join(profile, "cordis.patch.yml"), "[]\n");
  await createOnce(join(home, "settings.yaml"), "ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n");
  for (const name of profilePackages) {
    const source = await realpath(join(runtime, "node_modules", name));
    const destination = join(profile, "node_modules", name);
    await mkdir(dirname(destination), { recursive: true });
    try { await symlink(source, destination, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (error.code !== "EEXIST" || await realpath(destination) !== source)
        throw new Error(`Profile package ${name} points at another runtime; use a dedicated state directory`, { cause: error });
    }
  }
}

export async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => server.once("error", reject).listen(0, "127.0.0.1", done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function waitUntil(check, signal, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (await check()) return;
    // delay rejects with a bare AbortError, so surface the real reason (missing temporal, crashed runtime)
    await delay(250, undefined, { signal }).catch(() => signal.throwIfAborted());
  }
  throw new Error("Runtime startup timed out");
}

export async function launch(config, signal, runtimeEnvironment = {}) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  // The existing DSH lock reclaims dead PIDs and never evicts a live writer.
  return withFileLock(join(config.stateDir, "headless"), async () => {
    const home = join(config.stateDir, "dsh"), workspace = join(config.stateDir, "workspaces");
    for (const name of [home, workspace, join(config.stateDir, "temporal"), join(config.stateDir, "state")])
      await mkdir(name, { recursive: true, mode: 0o700 });
    await createOnce(join(config.stateDir, "device-id"), `${randomUUID()}\n`);
    await prepareProfile(home);
    const temporalPort = await freePort();
    const controller = new AbortController();
    const stopped = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const children = [];
    const start = (command, args, options) => {
      const privateLogs=!!runtimeEnvironment.BEES_FLEET_JOB;
      const child = spawn(command, args, { stdio: ["ignore", privateLogs?"pipe":"inherit", privateLogs?"pipe":"inherit"],
        detached: process.platform !== "win32", ...options });
      if(privateLogs)for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{
        process.stderr.write(line.replace(/([?&]token=)[^\s&]+/g,'$1[redacted]').replaceAll(config.token,'[redacted]')+'\n');
      });
      const exit = new Promise((done) => {
        child.once("error", (error) => { controller.abort(error); done(); });
        child.once("exit", (code, killed) => { controller.abort(new Error(`${command} exited (${code ?? killed})`)); done(); });
      });
      children.push({ child, exit });
    };
    const kill = (child, how) => {
      try { if (process.platform === "win32") child.kill(how); else process.kill(-child.pid, how); }
      catch (error) { if (error.code !== "ESRCH" && error.code !== "EINVAL") throw error; }
    };
    try {
      stopped.throwIfAborted();
      const temporalEnv = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "HOME", "TMPDIR", "TEMP", "TMP"]
        .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      start(config.temporalBinary, ["server", "start-dev", "--headless", "--ip", "127.0.0.1",
        "--port", String(temporalPort), "--db-filename", join(config.stateDir, "temporal", "processes-v4.db"),
        "--sqlite-pragma", "journal_mode=WAL", "--sqlite-pragma", "synchronous=FULL",
        "--sqlite-pragma", "busy_timeout=5000", "--disable-config-file", "--disable-config-env"], { env: temporalEnv });
      await waitUntil(() => new Promise((done) => {
        const socket = connect(temporalPort, "127.0.0.1");
        const finish = (ready) => { socket.destroy(); done(ready); };
        socket.once("connect", () => finish(true)).once("error", () => finish(false));
        socket.setTimeout(500, () => finish(false));
      }), stopped, 30_000);
      start(process.execPath, ["--max-http-header-size=65536", join(runtime, "start.mjs"),
        "--profile", "bees", "--host", config.host, "--port", String(config.port), "--no-open"], {
        cwd: workspace,
        env: { ...process.env, ...runtimeEnvironment, BEES_HOST_HOME: process.env.BEES_HOST_HOME || homedir(), HOME: config.stateDir, USERPROFILE: config.stateDir,
          BEES_HEADLESS: "1", BEES_FLEET_JOB: "client", DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1",
          BEES_DSH_TOKEN: config.token, BEES_DSH_QUERY_PATH: join(home, "session-query.sqlite"),
          BEES_DATA_DIR: config.stateDir,
          BEES_APP_DATA: config.stateDir, BEES_DEFAULT_WORKSPACE: workspace,
          BEES_STATE_DIR: join(config.stateDir, "state"), BEES_STARTUP_LOG: join(config.stateDir, "state", "startup.log"),
          BEES_RUNTIME_ROOT: runtime, BEES_TEMPORAL_ADDRESS: `127.0.0.1:${temporalPort}`, BEES_PRODUCT_SOURCE: "" }
      });
      await waitUntil(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${config.port}/bees-api/snapshot`,
            { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1000) });
          await response.body?.cancel(); return response.ok;
        } catch { return false; }
      }, stopped);
      console.log(JSON.stringify({ event: "bees.ready", host: config.host, port: config.port }));
      await new Promise((done) => {
        if (stopped.aborted) done(); else stopped.addEventListener("abort", done, { once: true });
      });
      if (!signal?.aborted) throw stopped.reason;
    } finally {
      for (const { child, exit } of children.reverse()) {
        if (!child.pid) continue;
        kill(child, "SIGTERM");
        const timer = setTimeout(() => kill(child, "SIGKILL"), 10_000);
        try { await exit; } finally { clearTimeout(timer); kill(child, "SIGKILL"); }
      }
    }
  }, { waitMs: 0 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  for (const name of ["SIGTERM", "SIGINT"]) process.once(name, () => controller.abort());
  try {
    if (!process.argv[2]) throw new Error("Usage: node dsh-runtime/headless.mjs CONFIG.json");
    const config = launchConfig(JSON.parse(await readFile(process.argv[2], "utf8")));
    // A replacement container can reuse PID 1. This fresh CLI cannot own its previous lock.
    // Each runner must have its own state volume; PID locks cannot coordinate separate PID namespaces.
    const lock = join(config.stateDir, "headless.lock");
    try { if ((await readFile(lock, "utf8")).trim() === String(process.pid)) await unlink(lock); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await launch(config, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) { console.error(error.message); process.exitCode = 1; }
  }
}

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { runRunner, runnerConfig } from "./runner.mjs";

const { BEES_CONTROL_PLANE_URL, BEES_PAIR_CODE, BEES_RUNNER_MODEL_PROFILE } =
  process.env;
const endpoint = new URL(BEES_CONTROL_PLANE_URL);
const root = "/var/lib/bees",
  path = root + "/runner.json";
let existing;
try {
  existing = runnerConfig(JSON.parse(await readFile(path, "utf8")));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  endpoint.protocol !== "https:" &&
  !(
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(endpoint.hostname)
  )
)
  throw Error("A secure control plane is required");
if (!existing) {
  const response = await fetch(`${endpoint.origin}/api/runner/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: BEES_PAIR_CODE }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error("Cloud runner enrollment failed");
  const enrollment = await response.json();
  delete process.env.BEES_PAIR_CODE;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const config = runnerConfig({
    serverUrl: endpoint.origin,
    token: enrollment.token,
    stateDir: root + "/private",
    allowExecution: true,
    temporalBinary: "/usr/local/bin/temporal",
  });
  if (BEES_RUNNER_MODEL_PROFILE) {
    await writeFile(root + "/model.json", BEES_RUNNER_MODEL_PROFILE, {
      mode: 0o600,
    });
    config.profile = root + "/model.json";
    delete process.env.BEES_RUNNER_MODEL_PROFILE;
  }
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
} else if (existing.serverUrl !== endpoint.origin)
  throw Error("State volume belongs to another control plane");
delete process.env.BEES_PAIR_CODE;
delete process.env.BEES_RUNNER_MODEL_PROFILE;
const controller = new AbortController();
for (const name of ["SIGTERM", "SIGINT"])
  process.once(name, () => controller.abort());
await runRunner(path, controller.signal);

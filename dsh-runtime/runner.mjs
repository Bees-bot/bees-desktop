import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
  open,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { launch, launchConfig, freePort } from "./headless.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export function runnerConfig(value) {
  const url = new URL(value.serverUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw Error("Use an HTTPS Bees server or loopback development server");
  if (
    !isAbsolute(value.stateDir) ||
    value.stateDir === resolve("/") ||
    typeof value.token !== "string" ||
    value.token.length < 32 ||
    /\s/.test(value.token)
  )
    throw Error(
      "Runner needs a dedicated absolute state directory and enrollment token",
    );
  if (value.desktopPreferences && !isAbsolute(value.desktopPreferences))
    throw Error("Desktop preferences path must be absolute");
  return {
    ...value,
    serverUrl: url.origin,
    allowExecution: value.allowExecution === true,
  };
}
export function desktopPreferencesPath() {
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library/Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData/Roaming"))
        : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"));
  return join(base, "bot.bees.desktop/dsh-state/execution.json");
}
export async function executionAllowed(config) {
  if (!config.allowExecution) return false;
  if (!config.desktopPreferences) return true;
  try {
    return (
      JSON.parse(await readFile(config.desktopPreferences, "utf8"))
        .allow_local_execution === true
    );
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
export function client(config) {
  return async (path, body = {}) => {
    const r = await fetch(config.serverUrl + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const result = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(result.error?.message || "Bees server unavailable"),
        { status: r.status },
      );
    return result;
  };
}
export async function runJob(job, config, signal) {
  if (!/^[a-f0-9-]{36}$/i.test(job.id) || !Number.isSafeInteger(job.attempt))
    throw Error("Invalid execution identity");
  const api = client(config),
    controller = new AbortController(),
    stopped = AbortSignal.any([signal, controller.signal]);
  const root = join(config.stateDir, "jobs", job.id, String(job.attempt));
  const processDefinition = job.definition.processes.find(
    (p) => p.id === job.process_id,
  );
  const stage =
    processDefinition?.stages?.[job.stage_index ?? 0] ?? processDefinition;
  const assignment = job.definition.agents.find((a) => a.id === stage?.agentId);
  if (!processDefinition || !stage || !assignment)
    throw Error("Frozen process definition is incomplete");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const profile = join(root, "dsh/profiles/bees");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  if (config.profile)
    await copyFile(config.profile, join(profile, "cordis.patch.yml"));
  else {
    const model = assignment.model.replace(/^hosted\//, "");
    await writeFile(
      join(profile, "cordis.patch.yml"),
      JSON.stringify([
        {
          id: "llm-pi-ai",
          config: {
            providers: {
              hosted: {
                api: "openai-completions",
                baseURL: `${config.serverUrl}/api/runner/jobs/${job.id}/model`,
                headers: { authorization: `Bearer ${job.toolToken}` },
                models: [
                  {
                    id: model,
                    name: model,
                    contextWindow: 32768,
                    maxTokens: 4096,
                  },
                ],
              },
            },
          },
        },
        { id: "agent-default-model", config: { provider: "hosted", model } },
      ]),
      { mode: 0o600 },
    );
  }
  const temporary = join(root, "tmp");
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const port = await freePort(),
    token = randomBytes(32).toString("hex");
  let runtimeError;
  const runtime = launch(
    launchConfig(
      {
        stateDir: root,
        port,
        temporalBinary: config.temporalBinary ?? "temporal",
      },
      { BEES_DSH_TOKEN: token },
    ),
    stopped,
    {
      BEES_FLEET_JOB: job.id,
      BEES_RUNNER_PRIVATE_ROOT: config.stateDir,
      BEES_RUNNER_PROFILE: config.profile ?? "",
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
    },
  ).catch((error) => {
    runtimeError = error;
  });
  const local = async (path, body) => {
    stopped.throwIfAborted();
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([stopped, AbortSignal.timeout(20000)]),
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.error || "Runtime request failed");
    return value;
  };
  const command = (body) => local("/bees-api/command", body);
  const remote = (action, body = {}) =>
    api(`/api/runner/jobs/${job.id}/${action}`, {
      leaseToken: job.leaseToken,
      ...body,
    });
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void (async () => {
      if (config.canExecute && !(await config.canExecute()))
        throw Error("Local execution disabled");
      await remote("renew");
    })()
      .catch(() =>
        controller.abort(
          Error("Execution lease lost or local execution disabled"),
        ),
      )
      .finally(() => {
        renewing = false;
      });
  }, 5000);
  try {
    const end = Date.now() + 300000;
    let snapshot;
    while (Date.now() < end) {
      stopped.throwIfAborted();
      if (runtimeError) throw runtimeError;
      try {
        snapshot = await local("/bees-api/snapshot");
        break;
      } catch {
        await delay(300, undefined, { signal: stopped });
      }
    }
    if (!snapshot) throw Error("Runtime startup timed out");
    const workspaceId = snapshot.workspaces[0].id;
    const grants = stage.tools ?? [];
    if (grants.length)
      await local("/bees-api/capabilities", {
        action: "add_mcp_server",
        serverName: "hosted",
        transport: "stdio",
        command: processExec(),
        args: [join(here, "hosted-mcp.mjs")],
        secrets: {
          BEES_FLEET_URL: config.serverUrl,
          BEES_FLEET_TOOL_TOKEN: job.toolToken,
          BEES_FLEET_JOB: job.id,
          BEES_FLEET_LEASE: job.leaseToken,
        },
      });
    const agent = await command({
      action: "add_agent_assignment",
      workspaceId,
      presetId: "standard",
      name: assignment.name,
      instructions: assignment.instructions,
      model: config.profile
        ? assignment.model
        : "hosted/" + assignment.model.replace(/^hosted\//, ""),
      reasoningEffort: assignment.ui?.reasoningEffort || null,
      mcpAccess: grants.length ? "listed" : "none",
      mcpServers: grants.length ? ["hosted"] : [],
    });
    const workflow = await command({
      action: "create_process",
      workspaceId,
      name: processDefinition.name,
      description: processDefinition.instructions + "\n\n" + stage.instructions,
      stages: [
        { name: "Work", driver: "agent" },
        { name: "Done", driver: "terminal" },
      ],
      mcpAccess: grants.length ? "listed" : "none",
      mcpServers: grants.length ? ["hosted"] : [],
    });
    const item = await local("/bees-api/fleet/create", {
      processId: workflow.id,
      agentId: agent.id,
      title: job.input.title,
      description: `${job.input.description}\n\nCurrent stage: ${stage.name}\n${stage.instructions}\nProcess instructions: ${processDefinition.instructions}\nSaved process guidance: ${JSON.stringify((processDefinition.ui?.memory ?? []).filter(m => m.active).map(m => m.content))}\nPrior stage results: ${JSON.stringify(job.checkpoint ?? [])}\nCurrent time: ${new Date().toISOString()}`,
    });
    if (item.error) throw Error(item.error);
    const drive = await fetch(
      `${config.serverUrl}/api/runner/jobs/${job.id}/drive-inputs`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${job.toolToken}` },
        signal: AbortSignal.timeout(180000),
      },
    );
    if (!drive.ok) throw Error("Could not materialize granted Drive inputs");
    const { artifacts: driveArtifacts } = await drive.json();
    const inputIds = [
      ...new Set([
        ...(job.input.artifacts ?? []),
        ...driveArtifacts.map((a) => a.id),
      ]),
    ];
    const transferred = new Set();
    const transfer = async id => {
      if (transferred.has(id)) return;
      const artifact = await remote(`artifacts/${id}`),
        content = Buffer.from(artifact.content, "base64");
      if (
        createHash("sha256").update(content).digest("hex") !== artifact.digest
      )
        throw Error("Input integrity check failed");
      const name = String(artifact.name);
      if (/[\/\\\x00]/.test(name) || name === "." || name === "..")
        throw Error("Unsafe input name");
      await local("/bees-api/fleet/input", {
        name: `${id.slice(0, 8)}-${name}`,
        content: artifact.content,
      });
      transferred.add(id);
    };
    for (const id of inputIds) await transfer(id);
    await local("/bees-api/fleet/start", {});
    let after = 0,
      last = "",
      publishedQuestions = new Set(),
      conversation = new Map();
    for (;;) {
      stopped.throwIfAborted();
      if (runtimeError) throw runtimeError;
      const state = await local("/bees-api/snapshot"),
        row = state.items.find((x) => x.id === item.id);
      const runs = state.runs.filter((x) => x.workItemId === item.id);
      const progress = {
        phase: row?.runtimePhase,
        runs: runs.map((x) => ({
          id: x.id,
          status: x.status,
          summary: x.resultSummary,
          outputs: x.outputs,
        })),
      };
      if (JSON.stringify(progress) !== last) {
        last = JSON.stringify(progress);
        await remote("event", {
          eventId: randomUUID(),
          kind: "progress",
          data: progress,
        });
      }
      for (const run of runs) {
        const { history } = await local(
          "/bees-api/run-history?executionId=" + encodeURIComponent(run.id),
        );
        const rendered = JSON.stringify(history);
        if (rendered !== conversation.get(run.id)) {
          // Conversations are shared content; cap a snapshot rather than flooding the event log with tokens.
          await remote("event", {
            eventId: randomUUID(),
            kind: "conversation",
            data: {
              runId: run.id,
              history:
                rendered.length <= 500000
                  ? history
                  : {
                      message: "Conversation exceeds the shared preview limit",
                    },
            },
          });
          conversation.set(run.id, rendered);
        }
      }
      const pending = await local("/bees-api/fleet/questions");
      for (const q of pending.questions)
        if (!publishedQuestions.has(q.id)) {
          await remote("event", {
            eventId: randomUUID(),
            kind: "question",
            data: q,
          });
          publishedQuestions.add(q.id);
        }
      const controls = await remote("events", { after });
      for (const event of controls.events) {
        after = Number(event.seq);
        if (event.kind === "input" && event.data.attempt === job.attempt) await transfer(event.data.artifactId);
        if (
          event.kind === "answer" &&
          publishedQuestions.has(event.data.questionId)
        )
          await local("/bees-api/fleet/answer", event.data);
        if (event.kind === "prompt" && event.data.attempt === job.attempt) {
          try { await local("/bees-api/fleet/prompt", event.data); }
          catch (error) {
            stopped.throwIfAborted();
            await remote("event", { eventId: randomUUID(), kind: "progress", data: { messageError: String(error.message), requestId: event.data.requestId } });
          }
        }
      }
      if (["completed", "failed", "cancelled"].includes(row?.runtimePhase)) {
        const outputs = [];
        if (row.runtimePhase === "completed")
          for (const run of runs)
            for (const name of run.outputs ?? []) {
              const path = resolve(run.outputsPath, name),
                directory = await realpath(run.outputsPath);
              if (
                !(await realpath(path)).startsWith(directory + sep) ||
                (await stat(path)).size > 10_000_000
              )
                throw Error("Unsafe or oversized output");
              outputs.push(
                await remote("artifacts", {
                  name: name.split(/[\/\\]/).at(-1),
                  content: (await readFile(path)).toString("base64"),
                }),
              );
            }
        await remote("finish", {
          status: row.runtimePhase === "completed" ? "completed" : "failed",
          result: {
            summary: runs
              .map((x) => x.resultSummary)
              .filter(Boolean)
              .join("\n"),
            artifacts: outputs,
            error: row.runtimeError ?? null,
          },
        });
        return;
      }
      await delay(1000, undefined, { signal: stopped });
    }
  } catch (error) {
    await remote("finish", {
      status: "uncertain",
      result: {
        error:
          "Runner stopped before a verified result; inspect execution before retrying",
      },
    }).catch(() => {});
    throw error;
  } finally {
    clearInterval(timer);
    controller.abort();
    await runtime;
  }
}
const processExec = () => process.execPath;

export async function runRunner(path, signal) {
  const config = runnerConfig(JSON.parse(await readFile(path, "utf8"))),
    api = client(config);
  process.env.BEES_RUNNER_PRIVATE_ROOT = config.stateDir;
  process.env.BEES_RUNNER_CONFIG = resolve(path);
  while (!signal.aborted) {
    try {
      const current = runnerConfig(JSON.parse(await readFile(path, "utf8")));
      const status = await api("/api/runner/heartbeat", {
        capabilities: ["bees"],
      });
      if ((await executionAllowed(current)) && status.enabled) {
        const { job } = await api("/api/runner/claim");
        if (job)
          await runJob(
            job,
            {
              ...config,
              canExecute: async () =>
                executionAllowed(
                  runnerConfig(JSON.parse(await readFile(path, "utf8"))),
                ),
            },
            signal,
          );
      }
    } catch (error) {
      if (error.status === 401) throw error;
      console.error(
        "Runner could not finish this polling cycle; work remains recorded on Bees",
      );
    }
    await delay(5000, undefined, { signal }).catch(() => {});
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  for (const name of ["SIGTERM", "SIGINT"])
    process.once(name, () => controller.abort());
  try {
    if (process.argv[2] === "pair") {
      const [serverUrl, code, path] = process.argv.slice(3);
      if (!path)
        throw Error(
          "Usage: runner.mjs pair SERVER CODE /absolute/path/runner.json",
        );
      if (!isAbsolute(path))
        throw Error("The private runner configuration path must be absolute");
      const url = new URL(serverUrl);
      if (
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname))
        )
      )
        throw Error("Use HTTPS or loopback");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, "wx", 0o600);
      try {
        const response = await fetch(`${url.origin}/api/runner/enroll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!response.ok) throw Error("Pairing failed or expired");
        const enrolled = await response.json();
        await file.writeFile(
          JSON.stringify(
            {
              serverUrl: url.origin,
              stateDir: join(dirname(path), "bees-runner-state"),
              token: enrolled.token,
              allowExecution: false,
              desktopPreferences: desktopPreferencesPath(),
              temporalBinary: "temporal",
            },
            null,
            2,
          ),
        );
      } catch (error) {
        await file.close();
        await rm(path, { force: true });
        throw error;
      } finally {
        await file.close();
      }
      console.log(
        "Machine paired. Enable it in Bees, set allowExecution in its private configuration, then run npm run runner:start -- CONFIG.",
      );
    } else {
      if (!process.argv[2]) throw Error("Usage: runner.mjs CONFIG");
      await runRunner(process.argv[2], controller.signal);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

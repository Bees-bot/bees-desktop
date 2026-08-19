import { createMcpConnection, setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { openSite, showExecution } from "./browser.ts";
import { cliProviderRoutes } from "./cli-provider.ts";
import { oauthProviderRoutes } from "./oauth-provider.ts";
import { connectionSecret } from "./credentials.ts";
import { localModelRoutes, proxyLocalModelRequest } from "./local-provider.ts";
import {
  LOCAL_PROVIDER,
  loopbackModel,
  registerCliProviders,
  registerOpenAICodexProvider,
  registerOpenAICompatibleProvider
} from "./models.ts";
import { BeesRun } from "./agents/bees-run.ts";
import { BeesAssistant } from "./agents/bees-assistant.ts";
import { BeesCurator } from "./agents/bees-curator.ts";

const runtimeToken = process.env.BEES_FLUE_TOKEN ?? "";

/** pi-ai resolves auth per request; these endpoints are loopback, so the key is a constant. */
function staticKey(name: string, key: string) {
  return { apiKey: { name, resolve: async () => ({ auth: { apiKey: key }, source: name }) } };
}

// ponytail: the loopback shims stay. The architecture plan allows deleting the
// /local-model/v1 proxy for a provider pointing straight at each llama-server, but only once
// a spike proves equivalent cancellation and streaming — and the CLI shim cannot go at all
// until a provider call context can resolve the run's workspace. Both are Phase 1b-7.
setProvider(
  createProvider({
    id: LOCAL_PROVIDER,
    name: "Bees local",
    auth: staticKey("Bees local", runtimeToken),
    models: ["active", ...Object.keys(localModelRoutes())].map((id) =>
      loopbackModel(LOCAL_PROVIDER, id)
    ),
    api: openAICompletionsApi()
  })
);

// The CLI-backed providers loop back into this same server (see cli-provider.ts), so they
// need the port this process was started on — the desktop app passes it as BEES_SELF_URL.
// Their per-run model ids are declared as the runs start; see `declareModel` in models.ts.
registerCliProviders();
registerOpenAICodexProvider();
registerOpenAICompatibleProvider();

const app = new Hono();
const localRoutes = localModelRoutes();

// Flue agent mounts have no authentication of their own, and 127.0.0.1 is not a boundary:
// any other local process can guess a route and read a conversation, send work, abort a run,
// or fetch an attachment. The desktop host generates this bearer per launch and gives it only
// to its own clients. Mounting is the exposure decision; this is the guard on it.
async function guardLoopback(context: Context, next: Next): Promise<Response | void> {
  const offered = context.req.header("authorization") ?? "";
  const expected = process.env.BEES_FLUE_TOKEN ?? runtimeToken;
  if (!expected || offered !== `Bearer ${expected}`) {
    return context.json({ error: "unauthorized" }, 401);
  }
  await next();
}

app.use("/agents/*", guardLoopback);
app.use("/browser/*", guardLoopback);
app.use("/local-model/*", guardLoopback);
app.use("/cli/*", guardLoopback);
app.use("/oauth/*", guardLoopback);
app.use("/connections/*", guardLoopback);

app.all("/local-model/v1/*", (context) =>
  proxyLocalModelRequest(context.req.raw, localRoutes)
);

// Open a team's persistent Chrome window at a URL so the user can log in manually,
// outside of any agent run. profileKey is the team folder path (teamRoot).
app.post("/browser/open", async (context) => {
  const { profileKey, url } = await context.req.json<{ profileKey?: string; url?: string }>();
  if (!profileKey || !url) return context.json({ error: "profileKey and url are required" }, 400);
  try {
    return context.json(await openSite(profileKey, url));
  } catch (error) {
    return context.json({ error: (error as Error).message }, 500);
  }
});

// Restore the Chrome tab owned by one execution when the user explicitly asks to see it.
app.post("/browser/show", async (context) => {
  const { instanceId, url } = await context.req.json<{ instanceId?: string; url?: string }>();
  if (!instanceId) return context.json({ error: "instanceId is required" }, 400);
  try {
    return context.json(await showExecution(instanceId, url));
  } catch (error) {
    return context.json({ error: (error as Error).message }, 500);
  }
});

app.route("/", cliProviderRoutes);
app.route("/", oauthProviderRoutes);

app.post("/connections/discover", async (context) => {
  const input = await context.req.json<{
    name?: string;
    url?: string;
    transport?: "streamable-http" | "sse";
    secretRef?: string;
    teamId?: string;
    id?: string;
  }>();
  if (!input.name || !input.url || !input.teamId || !input.id) {
    return context.json({ error: "name, url, teamId and id are required" }, 400);
  }
  let connection;
  try {
    const name = input.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    connection = await createMcpConnection({
      name,
      url: input.url,
      transport: input.transport ?? "streamable-http",
      // A public API carries no credential, so there is none to ask the broker for. The run path
      // already treats it as optional; discovery refusing it was the only thing in the way.
      ...(input.secretRef
        ? {
          auth: () => connectionSecret(input.secretRef!, {
            teamId: input.teamId!,
            connectionId: input.id!
          })
        }
        : {})
    });
    return context.json({
      tools: connection.tools.map(({ name: toolName, description }) => ({
        name: toolName.startsWith(`mcp__${name}__`) ? toolName.slice(`mcp__${name}__`.length) : toolName,
        description,
        // adapter drops readOnlyHint; the operator marks these instead
        readOnly: false
      }))
    });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  } finally {
    await connection?.close().catch(() => undefined);
  }
});

app.route("/agents/bees-run", createAgentRouter(BeesRun));
app.route("/agents/bees-assistant", createAgentRouter(BeesAssistant));
app.route("/agents/bees-curator", createAgentRouter(BeesCurator));

export default app;

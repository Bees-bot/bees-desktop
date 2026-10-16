# Stage 1: portable Bees runtime

This stage adds a headless entry point to the existing DSH runtime. The agent engine,
product APIs, MCP integration, browser UI, SQLite database and Temporal workflows
are the same code shipped by Tauri. Tauri retains its existing startup path.
The server and website need no changes for this stage.

## Scope and review gate

This is a private compatibility proof for one runner. It does not provide SaaS
accounts, tenant provisioning, desktop execution controls, machine routing, shared
connector credentials or production durability. Approve this runtime boundary
before starting Stage 2. Deployment requires separate approval under AGENTS.md.

The launcher requires a dedicated absolute state directory and a random access
token. It prepares the same profile packages as Tauri, starts a loopback Temporal
service, waits for the authenticated Bees API, and supervises both processes.
SIGINT/SIGTERM stops Bees before Temporal; unexpected sidecar exits fail the
launcher. A writer lock prevents two launchers sharing the same state directory.
The CLI handles a replacement container reusing the PID in an abandoned lock.
Use one state volume per runner: PID locks do not coordinate separate containers.

Headless mode uses the supplied PATH instead of reading an interactive login shell.
It also disables automatic local Hindsight installation. Local model binaries and
the Python memory installer are omitted from the image. Hosted models and MCP tools
remain available; this proof uses a synthetic OpenAI-compatible model and stdio MCP.

## Run without Tauri

Use Node 24.7 or newer 24.x and the pinned Temporal CLI 1.8.2. Run `npm install`
in the desktop repository first. On a prepared Mac development checkout, the
Temporal executable is under `src-tauri/binaries/`.

Create a configuration outside source, with an unused state directory:

```json
{
  "stateDir": "/absolute/path/to/a/new/bees-runner",
  "host": "127.0.0.1",
  "port": 8080,
  "temporalBinary": "/absolute/path/to/temporal"
}
```

Generate a private token and start the runner:

```sh
export BEES_DSH_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run start:headless -- /absolute/path/to/config.json
```

Use bearer authentication for the existing `/bees-api/` endpoints. To inspect the
existing browser UI locally, open `http://127.0.0.1:8080/bees-auth?token=YOUR_TOKEN`
on the same machine. Do not publish that URL. Token authentication and the existing
HTTP origin guard are a development interface; SaaS needs its own authenticated
gateway and browser session handling in later stages.

## Build and test the container

From the desktop repository:

```sh
docker build --platform linux/amd64 -f deploy/headless/Dockerfile -t bees-stage1 .
docker run --rm --platform linux/amd64 --network none bees-stage1 node scripts/check-headless.mjs
```

The image runs as the `node` user. Its Docker context allowlist excludes local
credentials, databases, node_modules and unrelated directories. Native modules
are installed for Linux, not copied from the developer's computer. Existing build
scripts download and verify the pinned Temporal and FreeLLMAPI artifacts.

For a persistent local container, retain the token and its named volume:

```sh
docker run --rm --name bees-stage1 --stop-timeout 30 \
  --platform linux/amd64 -p 127.0.0.1:8080:8080 \
  -e BEES_DSH_TOKEN -v bees-stage1-data:/var/lib/bees bees-stage1
```

Stop it with `docker stop bees-stage1`, then run the same command again. The
volume holds the product database, workflow database, credentials, profile,
device identity and workspaces. Removing the volume removes that runner's state.

## Cloudflare compatibility proof

Bees requires a Linux container behind a Worker; it cannot run directly in a
[standard Worker Node runtime](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).
The proof uses the documented [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/)
and the [container build configuration](https://developers.cloudflare.com/containers/configuration/wrangler/).

The Worker only accepts authenticated `POST /proof`. It starts one container,
with Internet access disabled, executes the fixed synthetic test, returns its
result, and destroys the container. It accepts no customer commands or credentials.
One Durable Object and a one-instance limit keep this a bounded development proof.

```sh
cd deploy/headless/cloudflare
npm ci --ignore-scripts
npm run check
npm run validate
```

`validate` is a local Wrangler dry run, including the image build; it does not
deploy. After explicit deployment approval, an operator would configure a random
`BEES_PROOF_TOKEN` Worker secret, deploy, and call `/proof` with its bearer token.
No live deployment has been performed as part of this implementation.

## Verification and limits

`npm run check:headless` boots the real runtime in temporary state, rejects invalid
configuration and unauthenticated requests, rejects a second launcher, handles an
abandoned lock with a reused PID, runs a model-driven process through MCP discovery,
the MCP call and stage submission, then restarts and verifies completion, device
identity and saved settings. It verifies that no local memory installation occurs.
It needs local ports and Temporal; it uses no personal accounts or paid providers.
The same test runs in the Linux image with no Internet access.

The desktop checks and Worker tests cover regressions, access control and proof
cleanup. A native Tauri UI launch and live Cloudflare run remain manual review checks.
Restart verification currently covers a clean restart and completed work, not
resumption during a partially completed external action.

Temporal's development server and local SQLite files are suitable for this proof.
Cloudflare container replacement does not promise persistence for those files.
The Durable Object's SQLite storage does not automatically persist the container
filesystem. Production scheduling, recovery, durable state, secret handling and
tenant isolation must be designed before enabling customer workloads. The image
also retains the existing FreeLLMAPI dependency; production dependency review is
still required before public rollout.

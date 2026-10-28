# Bees Client

`main-3` is a fresh thread-based architecture, replacing Bees Desktop. The desktop app and hosted browser use the same thread screen: threads on the left, discussion and AI work in the middle, results/files on the right. On narrow screens files open in a drawer.

Install/open the desktop Client, connect an AI in Settings, and start a thread. A Default team is created automatically; its heading is hidden until there is more than one team. Use the Bees logo menu to switch organizations, create an organization, or create a team. The navigation rail shows the selected team, offers New Goal and New Chat, and opens team settings with the gear below Chat. Team menus offer creation actions, Processes, and Settings. Global, organization, and team settings open in the main right panel. No account, organization, workspace, root folder, or Drive provider is required for local work. The desktop app defaults to local execution. Accounts are needed only to share work or connect machines.

Chat alternates between your message and an AI reply, retaining conversation history for each turn. Its single Chat stage returns to Your turn after replying and resumes on your next message. Goals use Work and Review stages. Both processes inherit team instructions, memory, files, and local integrations.

Creating an organization also creates its Default team. The client repairs older empty organizations owned by the signed-in user once, without duplicating existing teams. Team owners can create, edit, and delete named processes under Team settings → Processes; editors can start threads from them. Existing threads retain their saved stages when a process is edited or deleted.

## How work lives and moves

Each thread has exactly one owning Client. Its SQLite document and content-addressed files live in that Client's managed private storage. Run workspaces live under `~/Bees`, created on first launch. Global settings → Root folder changes this location; organization administrators can set a local override under Org settings. Changing folders copies existing run files and keeps the originals; account databases and credentials stay in private application storage. Hosted Clients manage their folders automatically. Shared participants keep local copies of the thread and its files; Clients refresh these copies automatically while connected. Editors send changes to the owner, which orders and deduplicates them. A viewer cannot mutate or start work. Thread owners control access and approvals.

Workflows have Work, Independent review, and Your approval stages. Team settings hold instructions, shared memory, workflow stages, files, timezone-aware schedules, MCP integrations, and browser access. Instructions and memory apply to all threads; a team workflow remains the default for threads without an explicitly selected process. New Goal and New Chat retain their selected process. Team schedules start a new thread per occurrence while the owning Client is running; missed occurrences coalesce into one catch-up. Existing thread settings are preserved and editable under Team settings → Existing thread settings. Integration credentials and browser access remain local to each Client. Interrupted execution is marked uncertain and requires explicit review/retry, because an external action might already have occurred.

Team settings → Agents creates named agents with instructions, a preset, model, reasoning effort, and add-on access. Assign agents to process or workflow stages. Each run saves the chosen agent's configuration; later edits leave execution history intact. Use your own browser is on by default on supported desktop browsers, with explicit opt-outs retained.

Team settings → Memory includes automatic Hindsight memory and manual shared notes. Automatic memory remembers completed goals and recalls team outcomes for new work. It runs on this Client, requires a running local OpenAI-compatible model, and downloads its dependencies on first setup. Outcomes queue durably while memory is unavailable. The settings let users select a local model, disable memory, correct or forget outcomes, and optionally connect their own Hindsight endpoint. Banks and credentials are isolated by Client and team; automatic memories are not synchronized to other Clients.

**Share** creates an email-addressed team invitation, including for vendors outside your organization. Team membership grants access to existing and future threads in the team. Existing individual thread invitations remain valid. Send the generated link to the person invited. The invited account must verify its email. The link alone does not grant access. Everyone on a shared thread uses the same configured Bees Server; private-server guests need an account and network access there. Organizations provide a colleague/client directory and SSO administration; membership never shares a thread automatically.

**Transfer** moves a stopped thread to another enrolled Client, including another Client belonging to your own account. The source freezes the checkpoint. The recipient verifies the checkpoint and file hashes and accepts it. Execution responsibility then moves to that Client. Keep the source online until acceptance. Active OS/model processes are not migrated. Failed delivery can be retried or cancelled.

| Setup | Supported behavior |
| --- | --- |
| One local user, no Server | Private threads, files, AI work and local schedules |
| Same account on several machines | Sign in through one Server; share/transfer individual threads |
| Many accounts/organizations in SaaS | One persistent isolated hosted Client per account; shared directory/relay API |
| Enterprise on a disconnected network | Desktop Clients plus a reachable private Bees Server |
| Free offline organization without a Server | Not supported; no LAN discovery or pairing |
| Vendor/external guest | Verified email invitation to an individual thread, without org membership |

Clients obtain peer addresses and per-thread grants from Bees Server. Direct HTTPS with TLS certificate trust is attempted first. If it cannot connect, an encrypted live relay is used. No server-side work sync database or offline store exists. Fresh content and accepted changes need a reachable owner and Server. Existing local copies remain readable offline. Logging into a different Client does not transfer work automatically.

## Development

Node 24.7 and the native platform build prerequisites are required.

```sh
npm ci
npm run tauri:dev
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
npm run check:headless
```

`npm run check` covers account isolation, storage/transfer validation, tool path fences, schedules, hosted routing, OpenAI-compatible connections, subscription adapters, file locking, page fetching, and both UI builds. `check:headless` boots the actual Client, runs an actual agent loop against a synthetic local model, verifies independent work/review, execution deduplication, shutdown, and restart persistence. Peer transport tests live in the sibling `bees-server` repository and use these Client modules directly.

`npm run check:web` runs the full shared suite, then the same agent proof through the hosted gateway with cookie authentication and a hosted worker. It also checks rejected sessions, cross-origin requests, desktop-only onboarding, and managed web folders. The directory and model are local fixtures; it does not charge customers or modify production accounts.

Account profiles separate threads, certificates and device credentials. First startup offers a Bees organization with $0.01 of provider-cost starter credit (once per Bees user id, with no starter token quota), or a local organization using your own AI. Local mode needs no account. User-configured AI connections remain machine-scoped. Bees Credits is account-scoped and uses one personal balance across organizations, desktop, and web. Credits are metered through the Server using its LLM_MODEL, LLM_BASE_URL, LLM_REASONING_EFFORT, and private LLM_API_KEY; provider credentials are never sent to a Client. Existing explicit model choices are preserved, and operator changes to the credit model refresh within 30 seconds. Root and child agents keep account-scoped billing credentials isolated. Hosted users get separate containers and persistent volumes.

## Open headless Bees from your other devices

With Tailscale running and MagicDNS plus HTTPS turned on for your tailnet, run:

```sh
npm run start:phone
```

It starts headless Bees on 127.0.0.1:8090 with its state in `~/.bees-headless`, serves it to your tailnet on port 8443 with `tailscale serve`, and prints a sign-in link. Open that link once on each device. The link gives the whole agent, shell included, so keep it private and limit the port to your own devices in your tailnet access rules. It refuses to start if port 8443 is public through `tailscale funnel`. Delete `~/.bees-headless/phone-token` to sign every device out, and run `tailscale serve --https=8443 off` to stop serving.

## Hosted Clients

Build the Client image with `docker build -f deploy/headless/Dockerfile -t bees-client:main-3 .`. Run `npm run build:hosted` for browser assets. On a dedicated Docker host, run `node dsh-runtime/hosted-clients.mjs` behind HTTPS using the environment template and service in `deploy/hosted`.

The gateway binds loopback behind your HTTPS reverse proxy. It verifies the account session on every request and proxies only the thread and file APIs. It starts one container and named durable volume per `(Server origin, account ID)`. Containers have read-only roots, private loopback HTTP ports, bounded CPU/memory/processes, no extra capabilities and no Docker socket. Only the trusted gateway can control Docker. Set `BEES_CLIENT_IMAGE` to a reviewed registry digest (or immutable local `sha256:` image ID).

Hosted Clients use the same Bees Credits connection as desktop. In Global settings → Credits & billing, choose any USD amount of at least $10 at $1 per million input plus output tokens. The chosen amount also becomes the auto-renew amount when opted in. Refills occur at 100,000 tokens remaining; balances and payment settings belong to the user, never an organization. Stripe Checkout collects card details and explicit recharge consent. Users can update the refill amount or turn auto-renew off in either Client. Starter requests use a server-held per-user OpenRouter key with a lifetime $0.01 cap and do not reserve or deduct purchased tokens. After starter credit is exhausted, purchased packs retain token metering. Model rejection returns purchased-token reservations; unconfirmed purchased-token requests retain a hold for provider reconciliation. BEES_HOSTED_RUNS_PER_DAY=0 disables the separate daily run cap by default, so purchased credits are not limited to one run a day; operators can set an explicit cap. An optional private hosted provider profile remains separate from credit-backed AI. Web keeps every added account signed in and shows their organizations together in the sidebar, with emails distinguishing accounts. Switching organizations changes the current view while the other hosted Clients keep running. Browser sign-out removes only the current account from that browser while owned work can continue in the hosted Client. Persistent volumes need independent backups.

For the production GKE cluster, `deploy/hosted/kubernetes.yaml` runs the same gateway with the Kubernetes backend. Build for `linux/amd64`, push the tested image, replace both `__CLIENT_IMAGE__` placeholders with its full registry `@sha256:` digest, and apply the manifest. The existing `app.bees.bot` API ingress owns TLS; the new ingress routes `/app`, `/bees-api`, and `/bees-auth` to the Client gateway. Keep the API at one replica with `Recreate` while its relay registry is in memory.

Before deploying an image, run its actual Linux proof (the native-addon loader needs an executable temporary directory):

```sh
docker run --rm --platform linux/amd64 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 2g --cpus 2 \
  --tmpfs /tmp:rw,exec,nosuid,size=512m -e BEES_PROOF_HOST=0.0.0.0 --entrypoint node \
  "$BEES_CLIENT_IMAGE" scripts/check-headless.mjs
```

Kubernetes accounts receive separate non-root workers, private Services, credentials and 10 GiB retained volumes. Workers have no Kubernetes credentials. NetworkPolicy blocks other accounts, private network addresses and cloud metadata; its service CIDR exclusion and DNS service IP must match the target cluster. This manifest requires a NetworkPolicy-capable cluster and the `gcp-balanced-retain` storage class. The gateway defaults to ten accounts; size capacity before raising that limit. Idle Clients update on their next request; active work delays the image change. Rollback uses the previous gateway image and `BEES_CLIENT_IMAGE` digest and leaves account volumes intact.

For Bees Credits, apply Server migration 009_user_credits.sql and configure LLM_MODEL, LLM_BASE_URL, LLM_REASONING_EFFORT, and LLM_API_KEY on the API Server. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET there for purchases and opt-in automatic refills; see the Server README for webhook events and test-mode validation. No credit model or shared provider key belongs in a desktop bundle or hosted Client image. The desktop .env does not configure the deployed Server. Private operators can still supply an independent BEES_HOSTED_MODEL / BEES_MODEL_PROFILE through the optional bees-hosted-model Secret. Configure SMTP or Cloudflare on the API for account mail. Automatic memory needs its own local model or Hindsight service; manual team notes work independently.

Limits in this initial implementation: 10 MB per file, 250 MB of files and 8 MB of structured state per thread; HTTP address attempts followed by relay (no ICE); one relay process in the initial Server deployment. Revocation prevents further sync and execution requests; it cannot erase files someone already downloaded. There is no automatic owner takeover if its machine is lost.

## License

MIT OR Apache-2.0. See LICENSE files in this repository.

The installed runtime still reports upstream DSH/MCP and source-map security advisories. The October 22 audit also reports Hono/Nodemailer findings; recommended fixed releases currently return npm 404s. These findings remain unresolved and must be rechecked when patched packages become available.

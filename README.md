# Bees Desktop

Run agentic teams from your own computer while your agents, files, browser sessions, cookies, and passwords stay local.

Bees runs a team of AI agents on your computer instead of one assistant in a single chat window. Describe an outcome in plain language, and Bees turns it into stages: agents work through them on a shared board, and a separate reviewer checks each result before it moves on. It works with agents you may already run, such as Codex or Claude Code from the command line, a hosted model, or a local model, and it reaches outside tools through MCP servers (a standard way to plug tools into an agent), the same way OpenClaw or n8n do. You can mark a stage to need your approval, and its agent then cannot send, post, delete or pay through an MCP tool until you approve.

## Install

Download the build for your computer from the [download page](https://bees.bot/download/), or go straight to the [latest GitHub release](https://github.com/Bees-bot/bees-desktop/releases/latest).

- **macOS:** open the DMG and drag Bees to Applications. Builds we publish are signed and notarized by Apple, so Gatekeeper lets them open.
- **Windows:** run the installer. It is not code-signed yet, so SmartScreen will warn. Click "More info," check the name reads Bees, then "Run anyway."
- **Linux:** install the DEB, or run the AppImage directly. Linux packages are not signed.

You need 8 GB of memory for a cloud model, or 16 GB for a local model, plus 15 GB of free disk space. A local model itself is 2 to 5 GB, and the data folder can grow to about 10 GB.

Bees does not update itself yet. Watch the [releases page](https://github.com/Bees-bot/bees-desktop/releases) for new versions.

Open Bees. It creates a private workspace on this computer with no sign-in needed, so you can try it right away.

### Try it in about a minute

Open **Settings → AI connections** and connect one AI: Codex or Claude Code (Bees uses the subscription you already have), a hosted provider, or a local model.

Then, on **Home**, type this into the **What would you like to achieve?** box:

```
Browse Hacker News and give me a table of the current stories, grouped by category: news, Show HN, and Ask HN.
```

Select **Run**. Bees starts the work with your team's agents and opens it, a reviewer checks the table, and the result lands in that run. You can find it again under **Process Runs**.

## Features

- Describe an outcome in the **What would you like to achieve?** box, and Bees runs it with your team's agents. Choose **Configure** to set the Process, MCPs, and Input & Output tabs first.
- Multi-agent processes: agents work through stages on a shared board, and a separate reviewer checks each result before it moves on.
- Bring your own AI: connect Codex, Claude Code, a hosted provider, or a local model, per agent or as the system default.
- MCP servers and skills, scoped per agent: give one agent every tool, none, or a named few.
- Apps: install ready-made app packages from a catalog. Each one shows its publisher, what it can access, and its sources before you install it.
- Local knowledge search (Company Brain) over folders and Google Drive locations you map yourself.
- Long-term memory: Bees runs its own local memory service so agents recall past work without sending it to a cloud memory provider.
- Scheduling: turn a request into a recurring process, like a weekly report.
- Human in the loop: questions, approvals, and failures surface under **Needs your attention**. Approval is off by default and set per stage.

## Architecture

Bees is a [Tauri](https://tauri.app) app: Tauri owns the native lifecycle (the window and the installer) and launches DSH plus a bundled `llama.cpp` server for local model inference alongside it.

DSH is [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness), the open-source agent runtime Bees is built on. It supplies models and providers, credentials, sessions, agents, tools, skills, the MCP client, and approvals, as an internal runtime. Bees owns the visible UI and product settings on top of it.

- `dsh-runtime/plugin` is the Bees product plugin: the board, schedules, run and recovery links, file boundaries, local document search, audit receipts, and the shared UI shell.
- `dsh-runtime/plugins/*` holds smaller, optional plugins: Bees AI, FreeLLMAPI's free-tier routing, and direct custom OpenAI-compatible connections, each its own DSH host and web client package.
- Bees decides which MCP servers exist and who can use them. Rows live in `bees-stage1.db`; each enabled server runs as its own process, and every agent carries a policy of all, none, or a named few. Add servers and skills under Agents; secrets go into DSH's credential store.
- Product data lives in the app's own `bees-stage1.db`. Older Bees installs are not migrated into it.

## Privacy

Bees keeps two kinds of data separate, and the line between them does not move.

Stays on your computer, always:

- Document files and their contents
- Credentials, model connections, and installed models
- The local search index over your documents
- Run folders, session details, and other execution files

Can sync, only if you turn on team coordination:

- Organizations, teams, and memberships
- Process templates, runs, work items, schedules, and agent definitions
- A folder's logical ID and relative path, never the absolute path or its contents
- Titles and descriptions you type in

Storage access (Google Drive, OneDrive, a NAS, and so on) is controlled by that provider, separately from your Bees team membership. Neither one substitutes for the other.

When an agent runs, content you select can go straight from your computer to the AI provider or tool you picked for that agent, for example a hosted model, an MCP server, or a command-line agent. Those services have their own privacy terms. Choose a local model and local tools to keep that content on the machine too.

### What leaves your computer

Settings → AI connections offers four ways to add a model, and each sends your work differently:

- **Bees AI** (a local model) runs on this device through the bundled `llama.cpp` server. Only the first model download uses the network; after that, prompts stay on the machine.
- **AI subscriptions** (Claude Code or Codex): Codex signs in with your OpenAI account and talks to OpenAI directly from this computer. Claude Code runs the command-line tool you already installed and signed into; your prompts pass through it under your own subscription.
- **General AI APIs** (your own API keys) send your prompt and key straight from this computer to the provider you picked, such as OpenRouter, Google, or Groq.
- **Free LLM**, the built-in free-tier router, runs locally in the app, then sends your prompt on to the free-tier provider you picked and added a key for.

A Private organization never touches Bees Cloud. The desktop app is fully open source and works on its own. Only the optional team sync server, Bees Cloud, used by Regular organizations to sync members, tasks, and progress, is closed source, and it never receives file contents.

### Workspace memory

Bees runs its own local memory service (Hindsight) so agents can recall earlier work. The app installs it into its own data folder on first use and serves it on `http://127.0.0.1:8898`; you can point it at an authenticated HTTPS Hindsight instead. Memory extraction always runs on a local model, never a hosted one, so what gets remembered does not leave the machine during that step. Turning memory off stops new saves; it does not erase what is already stored. Use Forget to erase stored memories while still connected.

## Supported systems

Release builds cover four targets, and all four have to succeed before a release goes out:

- macOS, Apple Silicon
- macOS, Intel
- Linux x64 (DEB and AppImage)
- Windows x64 (MSI and EXE)

macOS builds are signed with a Developer ID and notarized by Apple. Windows and Linux installers are not signed yet, so Windows shows a SmartScreen warning. The Mac build has had far more real use so far than Linux and Windows.

See [Known limitations](docs/limitations.md) for the full list of what does not work yet, including why there is no in-app updater and why upgrading from version 0.1.1 does not bring your data across. Read it before you install.

## Roadmap

There is no separate roadmap document, only work the team has already flagged:

- An in-app updater, brought back once upgrading from old local data is safe. It shipped in 0.1.1 and was dropped in the 0.2 rewrite because the two versions use different local databases.
- Signed Windows installers, once the Azure signing account behind them is set up.

See [Known limitations](docs/limitations.md) for everything else that is deliberately not built yet.

## Contributing

We take feature requests and bug reports, not code. Only the Bees team can open pull requests here. [Ask for a feature](https://github.com/Bees-bot/bees-desktop/issues/new?template=feature_request.yml) or [report a bug](https://github.com/Bees-bot/bees-desktop/issues/new?template=bug_report.yml) instead, and see [CONTRIBUTING.md](CONTRIBUTING.md) for why. Everyone taking part is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for a vulnerability. Report it privately through GitHub's security advisory form for this repository, or by email to security@bees.bot. See [SECURITY.md](SECURITY.md) for what to include and what happens next.

## License

This repository, Bees Desktop, is open source under your choice of the [Apache License, Version 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT).

Bees Cloud, the optional coordination server that Regular organizations use to sync across teammates, lives in a separate repository, `bees-server`, and is not part of this repository or its license.

Bees Desktop also ships third-party software under its own terms, including LGPL-3 libraries inside libvips (an image-processing library it uses). [NOTICE](NOTICE) lists every component and its license.

## Development

Requires Node 24 (pinned in `.nvmrc`), npm 10+, Rust 1.88+, and a native desktop toolchain. On macOS the first build compiles `llama-server`, so it also needs CMake (`brew install cmake`). The app bundles its own Node 24 runtime; native modules built under an older Node break the free AI option on a fresh install. Codespaces and dev containers work for the API and the website, but not for this app: Tauri needs a real machine.

```sh
npm ci
npm run check                 # typecheck, then build
npm run prepare:dsh           # stages the Node runtime, llama.cpp and uv for the Rust build
cargo check --manifest-path src-tauri/Cargo.toml
make bees                     # start the desktop app against https://app.bees.bot (also: make)
```

Other commands, run from this repository:

```sh
make server   # start the local API and PostgreSQL from ../bees-server
make dev      # in another terminal, start the desktop app against http://localhost:3000
make build    # build the desktop release installer
```

`make server` needs Docker and the sibling server's dependencies installed (`npm --prefix ../bees-server ci`). It runs the server's own development command, which starts PostgreSQL, applies migrations, and starts the API. `Ctrl-C` stops the API; PostgreSQL keeps running until `npm --prefix ../bees-server run db:dev:stop`.

`make bees` and `make dev` both launch the app in development mode, against the deployed API and a local API respectively. Fully quit Bees before switching between them, since the URL is read at startup. The `127.0.0.1` redirect inside a browser sign-in URL is the expected local callback.

`npm run tauri:dev` uses the deployed API unless `BEES_ACCOUNT_API_URL` is set, and builds no installer. Development commands use `src-tauri/tauri.dev.conf.json`: the debug app reads DSH and llama.cpp straight from this checkout, so Cargo does not copy their resource trees on each build, and Preparation preserves unchanged Node and Temporal executable timestamps so Cargo can reuse the native build on repeat launches. Source and configuration changes still rebuild normally.

Production builds connect to `https://app.bees.bot` unless `BEES_ACCOUNT_API_URL` is set when launching the app. Build a release installer with `make build` (or `npm run tauri:build`).

DSH releases are upgraded as one pinned set through the [DSH upgrade checklist](docs/dsh-upgrade-checklist.md).

### Editing product defaults

In a development build, sign in with a platform admin account. **Global Settings → Platform Admin** appears only after the server confirms the role. Turn on **Edit product defaults**, then use the existing model, appearance, and layout controls. Turning it off returns those controls to your personal settings.

Changes save directly to the existing `dsh-runtime/plugin/cordis.patch.yml` in this checkout. The next build includes them as defaults; personal overrides remain personal. Credentials, downloads, and running models are device settings and are never written into the shipped configuration. There is no publish step or remote configuration store. Admin verification requires connectivity; ordinary installations use the bundled defaults offline. Release builds cannot edit the source checkout.

### The Apps catalog

Apps loads a hosted catalog when you open the Apps tab or select Refresh. Users inspect a package's name, description, publisher, access, and sources, then Install, finish setup, and Open. Packages live in `bees-apps`; installing one needs no JSON upload or GitHub credentials of your own. Installed versions are pinned; updating one needs a separate approval, preserves existing results, and requires stopping any schedule or active work on it first. An offline catalog is browse-only, while installs you already have keep working.

The catalog URL is `https://bees-bot.github.io/bees-apps/catalog.json`. Hosting it is a separate step; this repository's code does not publish it. Override the URL with `BEES_APP_CATALOG_URL` at launch to point at another credential-free HTTPS host. Only a future package schema or runtime capability needs a desktop upgrade.

Local apps use SQLite. Connected apps use the selected account and revisioned server storage for configuration, source receipts, records, drafts, decisions, and shared limits; they need a matching Bees Server update and connectivity, and failed writes never become offline approvals. See `bees-apps/README.md` for catalog publishing and the current 16 MB shared-state limit.

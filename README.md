# Bees Desktop

Bees is a local-first desktop application for coordinating AI-assisted work. Stage 1 runs as a product plugin inside a pinned DeepSeek Harness (DSH) host and Web Client. Files, credentials, agent execution, and physical paths stay on the user's machine.

## Development

### Dynamic app directory

Apps loads a hosted catalog on opening and on Refresh. Users inspect the name,
description, publisher, access and sources, then Install, finish setup and Open.
Packages stay in `bees-apps`; no JSON upload or user GitHub credentials are needed.
Installed versions are pinned. Updates require a separate approval and preserve
results; schedules and active work must be stopped first. An offline catalog is
browse-only, while existing local installs keep working.

The proposed catalog URL is `https://bees-bot.github.io/bees-apps/catalog.json`.
It must be published separately; this change does not enable hosting. Override
it with `BEES_APP_CATALOG_URL` at launch for another credential-free HTTPS host.
Only a future package schema/runtime capability needs a desktop upgrade.

Local apps use SQLite. Connected apps use the selected account and revisioned
server storage for configuration, source receipts, records, drafts, decisions
and shared limits. They need the matching Bees Server update and connectivity;
failed writes never become offline approvals. The existing desktop runtime
executes/schedules the work. No cloud worker, sending connector or paid service
is enabled by installation. See `bees-apps/README.md` for catalog publishing and
the current 16 MB shared-state limit.

Requirements: Node.js 22.19+, npm 10+, Rust 1.84+, and a native desktop toolchain.

```sh
npm ci
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
make bees
```

Run these commands from this repository:

```sh
make bees     # Start the desktop app with https://app.bees.bot (also: make prod or make)
make server   # Start the local API and PostgreSQL from ../bees-server
make dev      # In another terminal, start the desktop app with http://localhost:3000
make build    # Build the desktop release installer
```

`make server` requires Docker and the sibling server's dependencies installed (`npm --prefix ../bees-server ci`). It runs the server's existing development command, which starts PostgreSQL, applies migrations, and starts the API. `Ctrl-C` stops the API; PostgreSQL remains running until `npm --prefix ../bees-server run db:dev:stop`.

`bees`, `prod`, and `dev` launch the app in development mode; `prod` selects the deployed API and does not deploy anything. Fully quit Bees before switching servers because the URL is read at startup. The `127.0.0.1` redirect inside a browser sign-in URL is the expected local callback.

`npm run tauri:prod` launches the development app against the deployed API without building an installer. `npm run tauri:dev` also uses the deployed API by default; set `BEES_ACCOUNT_API_URL` to override it.

Production builds connect to `https://app.bees.bot` unless `BEES_ACCOUNT_API_URL` is set when launching the app.

Build an installer with `make build` (or `npm run tauri:build`).

DSH releases are upgraded as one pinned set through the
[DSH upgrade checklist](docs/dsh-upgrade-checklist.md).

## Architecture

- Tauri owns native lifecycle and launches DSH plus the bundled llama.cpp inference server.
- DSH supplies models/providers, credentials, sessions, agents, tools, skills, the MCP client, and approvals as an internal runtime; Bees owns the visible UI and product settings.
- `dsh-runtime/plugin` is the Bees product/core plugin: board, schedules, run/recovery links, file boundaries, local document search, audit receipts, and the shared UI shell.
- Bees owns which MCP servers exist and who may use them. Rows live in `bees-stage1.db`, each enabled one is mounted as its own `dsh-mcp-client` fiber, and every agent carries a policy of all, none, or a named few. Servers and skills are added under Agents, and secrets go to the DSH credential store.
- `dsh-runtime/plugins/*` contains small optional integration plugins. Bees AI, embedded FreeLLMAPI free-tier routing, and direct custom OpenAI-compatible connections each ship as a separate DSH Host + Web Client package.
- Product data starts fresh in the app-owned `bees-stage1.db`. Old Bees workspaces and runs are not migrated.

Bees is the only visible product surface. New users open Getting started: a resumable four-step checklist for a workspace, AI connection, optional files, and a first Goals task. It reuses the existing setup screens, offers a fictional sample brief, and tests the selected AI before starting work. Local model downloads are explicit; AI connections suggests a conservative model from the shipped catalog using available memory and disk space. Download progress stays visible while setup continues. Previously enabled local models resume on later launches.

## Data boundary

Selected company folders remain data-only. Bees stages inputs into app-data workspaces and publishes outputs only after approval in the Bees UI. Databases, sessions, indexes, checkpoints, browser profiles, credentials, and runtime metadata never go into a selected company folder.

## License

Licensed under either the [Apache License, Version 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option.

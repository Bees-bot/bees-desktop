# Bees Desktop

Bees is a local-first desktop application for coordinating AI-assisted work. Stage 1 runs as a product plugin inside a pinned DeepSeek Harness (DSH) host and Web Client. Files, credentials, agent execution, and physical paths stay on the user's machine.

## Development

Requirements: Node.js 22.19+, npm 10+, Rust 1.84+, and a native desktop toolchain.

```sh
npm ci
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:dev
```

`npm run tauri:dev` connects account features to `http://localhost:3000`. Production builds connect to `https://app.bees.bot`.

Build an installer with `npm run tauri:build`.

DSH releases are upgraded as one pinned set through the
[DSH upgrade checklist](docs/dsh-upgrade-checklist.md).

## Architecture

- Tauri owns native lifecycle and launches DSH plus the bundled llama.cpp inference server.
- DSH supplies models/providers, credentials, sessions, agents, tools, skills, the MCP client, and approvals as an internal runtime; Bees owns the visible UI and product settings.
- `dsh-runtime/plugin` is the Bees product/core plugin: board, schedules, run/recovery links, file boundaries, local document search, audit receipts, and the shared UI shell.
- Bees owns which MCP servers exist and who may use them. Rows live in `bees-stage1.db`, each enabled one is mounted as its own `dsh-mcp-client` fiber, and every agent carries a policy of all, none, or a named few. Servers and skills are added under Agents, and secrets go to the DSH credential store.
- `dsh-runtime/plugins/*` contains small optional integration plugins. Local AI, embedded FreeLLMAPI free-tier routing, and direct custom OpenAI-compatible connections each ship as a separate DSH Host + Web Client package.
- Product data starts fresh in the app-owned `bees-stage1.db`. Old Bees workspaces and runs are not migrated.

Bees is the only visible product surface. On first launch it downloads and starts the default local model, then resumes that model on later launches. Settings → AI connections shows download progress and lets a user run any shipped local model or connect another OpenAI-compatible endpoint.

## Data boundary

Selected company folders remain data-only. Bees stages inputs into app-data workspaces and publishes outputs only after approval in the Bees UI. Databases, sessions, indexes, checkpoints, browser profiles, credentials, and runtime metadata never go into a selected company folder.

## License

Licensed under either the [Apache License, Version 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option.

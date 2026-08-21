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

`BEES_API_URL=dev npm run tauri:dev` remains harmless, but the Stage 1 local desktop does not call the Bees server. Tauri starts Vite and a loopback-only DSH sidecar; do not start `npm run dev` separately.

Build an installer with `npm run tauri:build`.

DSH releases are upgraded as one pinned set through the
[DSH upgrade checklist](docs/dsh-upgrade-checklist.md).

## Architecture

- Tauri owns native lifecycle and launches DSH.
- DSH owns models/providers, credentials, sessions, agents, tools, skills, MCP, approvals, and UI composition.
- `dsh-runtime/plugin` owns the Bees board, schedules, run/recovery links, file boundaries, local document search, audit receipts, and Bees UI.
- Product data starts fresh in the app-owned `bees-stage1.db`. Old Bees workspaces and runs are not migrated.

The DSH button reveals the upstream client. The global Open Bees button returns to the product surface. DSH Models settings can configure hosted providers or a local OpenAI-compatible endpoint; Bees does not bundle a model server.

## Data boundary

Selected company folders remain data-only. Bees stages inputs into app-data workspaces and publishes outputs only after a DSH approval. Databases, sessions, indexes, checkpoints, browser profiles, credentials, and runtime metadata never go into a selected company folder.

## License

Licensed under either the [Apache License, Version 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option.

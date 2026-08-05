# Bees Desktop

Bees is a privacy-first desktop application for coordinating AI-assisted work.
Files, credentials, agent execution, and physical paths stay on the user's
machine. Connected organizations synchronize coordination metadata with the
Bees server.

## Development

Requirements: Node.js 22.19+, npm 10+, Rust 1.84+, CMake on macOS, and Python
3.11+ for local knowledge.

```sh
npm ci
npm run check
```

Run the desktop against the local server in the sibling `bees.bot` folder:

```sh
BEES_API_URL=dev npm run tauri:dev
```

Without `BEES_API_URL=dev`, the app uses `https://app.bees.bot`.

Build an installer:

```sh
npm run tauri:build
```

Local knowledge also needs its Python dependencies:

```sh
python3 -m pip install -e services/knowledge-worker
```

## Data boundary

The Bees server has no file-upload route. Connected sync rejects file bytes,
document contents, secrets, absolute paths, and path traversal. Use local
models and local tools for fully offline or air-gapped operation.

## Software Project process

Add **Software Project** from the process library to build a website, app, API,
CLI, or library through explicit gates: requirements, two-model architecture,
implementation planning, coding/testing loops, per-phase human review, and a
final review.

Project source is kept in a local Git worktree under `~/Bees/projects`, never
inside the team's synced folder. Bees commits every coding turn on an isolated
`bees/project/*` branch. Phase approval, final verification, and the local merge
are explicit UI actions; Bees never pushes the branch.

## Process modules

Bundled processes live under `src/processes/<process>/`. Each module owns its
definition, prompts, state rules, tests, and any custom Studio controller. The
small compile-time registry in `src/processes/registry.ts` exposes definitions
to the shared installer and identifies data-driven versus Studio processes.
Native process-specific code follows the same layout under
`src-tauri/src/processes/`.

## License

Licensed under either the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT License](LICENSE-MIT), at your option.

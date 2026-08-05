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

## License

Licensed under either the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT License](LICENSE-MIT), at your option.

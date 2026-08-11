# Contributing

Thanks for looking. We're two people, so anything you fix is genuinely useful.

## Before you start

Open an issue first if it's more than a small fix. Saves you writing something we
were about to change anyway.

Issues tagged `good first issue` should take under an hour. If one takes longer than
that, tell us, because the label is wrong.

## Getting it running

Bees is three repositories. This one is the desktop app:

- `bees-desktop`, here, the Tauri app
- `bees-server`, the API and PostgreSQL
- `bees-website`, the marketing site

There is no command that starts all of it. For desktop work against the local API you
need two terminals:

```sh
# Terminal 1, in bees-server
npm install
npm run dev            # Postgres, migrations, API on :3000

# Terminal 2, here
npm install
BEES_API_URL=dev npm run tauri:dev
```

`BEES_API_URL=dev` matters. Without it the app talks to production. Full detail is in
`bees-server/docs/build-deploy.md`.

Checks before you open a PR:

```sh
npm run check                                    # typecheck, tests, build
cargo check --manifest-path src-tauri/Cargo.toml
```

You'll need Node 22.19+, npm 10+, Rust 1.84+, Docker for the local Postgres, and
**CMake** (`brew install cmake` on Mac). Without CMake the build fails partway through
with "Building the macOS local-model runtime requires CMake". It compiles llama-server
from source for the bundled local model, and the first build takes a while.

**One heads up.** This is Tauri, so it needs a native toolchain. Codespaces and dev
containers are fine for the API and the website, but **not** for the desktop app. You
need a real machine. We'd rather tell you now than have you find out an hour in.

Tauri starts its own Vite server on port 1420. Don't run `npm run dev` here alongside
`npm run tauri:dev`; the plain `dev` script only exists for Tauri to call.

## What we're likely to say yes to

- Bug fixes, especially install and first-run problems on Windows and Linux
- Better error messages
- Docs, particularly troubleshooting for errors you actually hit
- New starter agents that do something genuinely useful

## What we're likely to say no to

- New agent runtime features. That's [Flue](https://github.com/withastro/flue), not us.
- Anything that uploads document contents anywhere
- Big refactors without an issue first
- New dependencies where a few lines would do

We'd rather say no clearly than leave your PR sitting for six months.

## How we work

- Branch off `main`, open a PR
- CI has to pass
- A change that touches more than one repository wants the same branch name in each,
  and a note in each PR saying which others go with it
- We'll reply within 3 working days. If we haven't, chase us, we've dropped it.
- Small PRs get merged faster, because they're easier to read
- Contributors get named in the release notes. There's no separate thank-you ritual,
  because that's the thing that quietly stops happening in a busy week
- Office hours every second week, not every week. Weekly is the promise everyone breaks,
  and a missed public promise costs more than one never made

## Code style

Match what's around it. TypeScript for business logic, Rust only where Tauri needs it.
There's no style guide beyond that and we're not going to invent one.

## Reporting security problems

Don't open a public issue. See [SECURITY.md](SECURITY.md).

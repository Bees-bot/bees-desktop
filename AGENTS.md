# Cross-repository development

Related folders:

- Desktop: `../bees-desktop`
- Server: `../bees-server`
- Website: `../bees-website`

When a task changes more than one repository:

1. Read `AGENTS.md` in every affected repository.
2. Keep server API changes backward-compatible when possible.
3. Update server and desktop consumers in the same task.
4. Run checks in every changed repository.
5. Never put server secrets in the desktop repository.
6. Use the same branch name in each affected repository.
7. Report changes and Git status separately for each repository.
8. Do not commit unless explicitly requested.

## Desktop checks

Run `npm run check` for TypeScript changes and
`cargo check --manifest-path src-tauri/Cargo.toml` for Rust changes. A release
build is `npm run tauri:build`.

## Working on the interface

`npm run dev:harness` serves the frontend to an ordinary browser, so layout can
be measured and driven with a real pointer without building a Tauri window. A
dev-only Vite plugin answers the Tauri command seam: database commands run
against an in-memory SQLite through `node:sqlite`, and the rest return canned
values. The seed data in `dev/harness/seed.mjs` is deliberately unkind — titles
that overflow, titles that repeat, a crowded stage and an empty team — because a
layout that only survives short strings has not been tested.

Add `?fail=cmd,cmd` to the URL to make those commands reject. Use it to check
that a launch step degrades rather than replacing the window: every step in
`app-bootstrap.ts` except opening the database is expected to fail without
costing the user their session.

The harness is null unless `BEES_HARNESS=1` and is marked `apply: "serve"`, so
no build carries any of it. Verify with
`grep -c __harness dist/index.html` after a build; the answer is 0.

# Cross-repository development

Related folders:

- Desktop: `../bees-desktop`
- Server: `../bees.bot`
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

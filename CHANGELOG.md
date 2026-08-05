# Changelog

Notable changes, newest first. Dates are release dates.

## Unreleased

- The app no longer refuses to start when its database predates a column. `schema.sql` is
  all `CREATE TABLE IF NOT EXISTS`, so a shipped update that added a column left every
  existing install crashing at launch with `no such column: conversation_text`. Columns are
  now added before the schema runs.

## 0.1.0

First build. Signed with a placeholder, so macOS and Windows still block it.
Treat it as a test build.

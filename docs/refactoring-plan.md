# Refactoring plan: `main.ts` and process unification

Two independent projects. **Part A is a prerequisite for nothing** — do it first because it is
mechanical and low-risk. **Part B is a real feature project** and should not start until Part A
has landed, because Part B touches the same files.

Repository: `bees-desktop`. Checks after every step:

```
npm run check                                   # typecheck + vitest + build
cargo check --manifest-path src-tauri/Cargo.toml   # only if Rust changed
```

Do not commit unless asked.

---

## Background: what this codebase actually is

Read this before either part, or you will pick the wrong rung.

`bees-desktop` is a Tauri app with two halves:

- `src/` — TypeScript, 26.8k lines. Runs in the webview. **Untrusted for enforcement.**
- `src-tauri/src/` — Rust, 6.6k lines. Native. Owns sqlite, the filesystem, process spawning,
  and every check that must not be bypassable.

Work flows through **processes**. A process has ordered **stages** and **agents** assigned to
stages. A **work item** sits in one stage. An agent **run** is submitted to the flue runtime,
writes files into `workspace/outputs/`, and Rust reads them back when the run settles.

The agent is the untrusted party. It reports its chosen stage by writing
`outputs/.status`. Rust reads that file at `src-tauri/src/runs.rs:637` and can fail the run.
**Validation happens on read, in Rust. Never move that to TypeScript.**

---

# Part A — carve up `main.ts`

## The problem

`src/main.ts` is **8561 lines with 234 top-level functions**. It mixes DOM rendering with
orchestration that has no DOM in it at all. Sibling modules already exist for most of that
orchestration and are already DOM-free:

| Module | Lines | DOM references |
| --- | ---: | ---: |
| `src/repository.ts` | 2232 | 0 |
| `src/domain.ts` | 657 | 1 |
| `src/launch-views.ts` | 641 | — |
| `src/control.ts` | 571 | 0 |
| `src/run-coordinator.ts` | 455 | 0 |
| `src/workspaces.ts` | 286 | — |
| `src/supervision.ts` | 216 | 0 |
| `src/connections.ts` | 98 | — |

The engine boundary already exists. `main.ts` is what leaked across it.

## The goal

**Move functions. Do not rewrite them.** Every step is a cut-and-paste plus an import. If a step
requires you to change behaviour, you have picked the wrong function — skip it and move on.

Target: `main.ts` under 4000 lines, containing only code that touches `document`, builds HTML
strings, or wires event listeners.

## Criterion for moving a function

Move it if **all** of these hold:

1. It does not reference `document`, `window`, `querySelector`, `innerHTML`, or `addEventListener`.
2. It does not return an HTML string.
3. It does not call a function that fails 1 or 2.

Verify with:

```
grep -c "document\.\|querySelector\|innerHTML\|addEventListener" src/main.ts
```

That count (currently 106) should be roughly unchanged when you finish — you are moving the
other ~8400 lines' worth of logic, not the DOM code.

## Verified starting set

These were confirmed non-DOM. Start here, one commit per group:

| Functions in `main.ts` | Move to |
| --- | --- |
| `reconcileServerOrgs`, `reconcileServerTeams`, `purgeLegacyConnectedTeams`, `forgetAccountConnections`, `persistConnections`, `persistAccounts`, `rememberAccount`, `connect`, `disconnect` | `src/connections.ts` |
| `signInUser`, `signUpUser`, `socialSignInUser`, `signOutAccount`, `handleAuthCallback`, `activeConnectionValid`, `orgSignedIn`, `orgToken`, `activeAccount`, `currentUser`, `firstConnUser`, `orgHasConnection`, `orgIsConnected`, `canConnectOrg` | new `src/accounts.ts` |
| `resumeCompletedGoals` | `src/run-coordinator.ts` |
| `loadKnowledgePolicy`, `saveKnowledgePolicy`, `ensureKnowledgeConnection` | `src/knowledge.ts` |
| `loadTheme`, `saveTheme`, `saveDefaultTheme`, `isThemePreset` | new `src/theme.ts` (`applyTheme` stays — it touches the DOM) |
| `routeDeepLink`, `handleInviteLink` | new `src/deep-links.ts` |
| `saveBranding`, `setBrandingValue`, `brandingFor`, `defaultOrgColor` | new `src/branding.ts` |
| `escapeHtml`, `formatBytes` | `src/markdown.ts` |
| `currentOrganization`, `currentTeam`, `scheduleItems`, `activeServerOrg`, `activeOrgTeamEnabled`, `openWork` | new `src/workspace-state.ts` |

Then sweep the remaining ~150 functions with the criterion above.

## Rules

- **One module per commit.** Run `npm run check` after each. A 9-function move that typechecks
  and passes tests is done; do not also tidy it.
- **Shared mutable state is the hard part.** `main.ts` has module-level state (`workspace`, the
  connections list, the accounts list) that moved functions read. When a moved function needs it,
  pass it as a parameter rather than exporting the mutable binding. If a function needs more than
  three such parameters, leave it in `main.ts` and note why.
- **Do not add abstractions.** No `AuthService` class, no dependency-injection container, no
  barrel `index.ts`. Modules with exported functions, same as `control.ts` and `supervision.ts`
  already are.
- **Do not write new tests for moved code.** It had none; moving it does not change that. Add a
  test only if you had to change behaviour, which you should not have.

## Done when

- `main.ts` is under 4000 lines
- `npm run check` passes
- No new dependencies in `package.json`
- Every new module is DOM-free and could be imported by a non-webview caller

---

# Part B — turn processes into data

## The problem

Two processes ship hardcoded, and every future one would have to be too.

| | Lines | Where |
| --- | ---: | --- |
| Code (`software-project`) | ~1516 | `src/processes/software-project/` + `src-tauri/src/processes/software_project.rs` |
| Goals | ~370 | `src/processes/goals/` + `src-tauri/src/processes/goals.rs` |

A user-built process, by contrast, is just ordered columns: `Stage { id, processId, name,
position, completionRules, archivedAt }` in `src/domain.ts:99`. There is no transition graph.
`checkpointWorkItem` (`src/repository.ts:1689`) resolves the agent's chosen stage by name, and
falls back to next-by-position when the name is unknown.

**`completionRules` is stored, queried, and synced — and evaluated nowhere.** Grep it. The slot
was reserved and never built. That is the seam this project opens.

## What is NOT the problem

Measured breakdown of the Code process's 1516 lines:

| | Lines |
| --- | ---: |
| prompts | 88 |
| output parsers (5 bespoke JSON shapes) | 110 |
| `handleAction` UI dispatch | 213 |
| architecture debate (4 methods) | ~210 |
| phase loop + final test | 87 |
| HTML view | 47 |
| git worktrees | 46 |
| plumbing, types, state | ~700 |
| **state routing (`routeSoftwareProject`)** | **~30** |

**The state machine is 2% of it.** Do not start this project by replacing the router, and do not
add XState — it addresses the 2%, cannot run in Rust where the enforcement lives, and its cost is
fixed while its savings scale with machine size. At eight states there is nothing to amortise.

The custom code is prompts, parsers, views, and side effects. Those four are the project.

## The four things that must become data

### B1. Transitions (smallest, do first)

Add transitions to the stage schema so a process declares its graph instead of walking by
position.

- New table or column carrying `{ from, on, to }` triples per process.
- `Stage.completionRules` already exists — decide whether transitions live there as JSON or in
  their own table. Prefer their own table; `completionRules` is a string field and stuffing a
  graph into it will hurt.
- Keep the position fallback for processes that declare nothing. Existing user processes must
  keep working untouched.
- `src/process-diagram.ts` already consumes `StageTransition[]`. Feed it the new data and every
  process gets a diagram for free.

### B2. Narrow the status menu, and enforce it

Today `src/run-coordinator.ts:155` offers the agent **every** stage of the process:

```ts
const menu = stages.filter((stage) => stage.trim());
```

Change it to the stages reachable from the item's current stage, per B1.

Then enforce membership in Rust, beside the other validators in `src-tauri/src/runs.rs` (~line
637):

```rust
if !request.stages.is_empty()
    && !status_name.is_empty()
    && !request.stages.iter().any(|s| s.trim().eq_ignore_ascii_case(status_name.trim()))
{
    return finish_terminal(database, request, "failed", Some(&conversation),
        Some(&format!("Run must choose one of: {}", request.stages.join(", "))));
}
```

`RunRequest.stages` already exists and is already populated — its doc comment says exactly this
("Status names the run may choose from"); the check was never written.

**This is the load-bearing change.** It makes transition rules enforceable for *any* process,
including user-built ones, without Rust knowing what a process is. Once it lands,
`validate_run` in `src-tauri/src/processes/goals.rs` (37 lines + 25 lines of tests) and
`validateGoalRun` in `src/processes/goals/index.ts` (33 lines) both become redundant — Goals'
rules ("Waiting is reserved", "Plan must choose Work") turn into *stages absent from the menu*.
Delete them in the same change, and keep the Rust tests' intent by re-asserting it against the
generic check.

### B3. Output schemas

Replace the five bespoke parsers with a declared schema per agent output.

Existing partial mechanism: `RunRequest.validation_rules` handles `require-output`,
`extension:.md`, `action-receipt`. Extend that vocabulary rather than inventing a parallel one.

- `parseRequirementSpec`, `parseArchitectureProposal`, `parseArchitectureCritique`,
  `parseImplementationPlan`, `parseTestReport` in `src/processes/software-project/index.ts`
- `parseTaskPlan` in `src/processes/goals/index.ts` — this one is the hardest; it validates 6
  fields across up to 25 tasks with per-field limits and a uniqueness constraint.

Keep validation in Rust where it already is. A schema that only the webview enforces is not
enforcement.

### B4. Effect vocabulary

The genuinely hard part. Each hardcoded process performs side effects that no state machine
describes:

- create a git worktree, snapshot a diff (`src/processes/software-project/git.ts`,
  `src-tauri/src/processes/software_project.rs`)
- run two agents concurrently and compare their output (the architecture debate)
- create N linked child work items from one approved output (`approveTaskPlan`)
- fan in: wait until every child work item is done (`completedGoalsReadyForReview`)

Design a named, declarative vocabulary for these, resolved against a registry the app owns —
never user-supplied executable code. A process declares `{ effect: "spawn-children", ... }`; the
registry maps the name to an implementation. This is the same shape as the MCP tool permission
model already in `src/run-config.ts:103-105`.

Start with `spawn-children` and the fan-in, because Goals needs only those two. Code needs the
git and concurrent-agent effects and should stay hardcoded until they exist.

## Sequencing

1. **B1** transitions in the schema, diagram wired up. Low risk, visible immediately.
2. **B2** narrow menu + Rust membership check. Delete `validate_run` and `validateGoalRun`.
   **This is the highest-value single change in the plan.**
3. **B3** output schemas, starting with the simpler Code parsers.
4. **B4** effect vocabulary, `spawn-children` and fan-in first.
5. Only then: convert Goals to a pure data process and delete `src/processes/goals/`.
6. Code stays `mode: "studio"` and stays hardcoded. It renders custom HTML and drives git; it is
   not the target. Reassess after step 5.

## Known hazards

- **In-flight work items.** A user edits a process while items sit in stages that edit removes.
  Today the position fallback absorbs this silently and cannot produce an invalid state. Any
  transition graph you add can. Decide the migration story *before* B1 ships, not after.
- **Rust is the enforcement boundary.** Anything a user or agent could benefit from bypassing
  must be checked in `src-tauri/`. TypeScript checks are for UX, not safety.
- **`mode: "data-driven" | "studio"`** in `src/processes/types.ts` is the existing seam. Keep it.
  A general engine plus one special case is a fine outcome; forcing Code into the general model
  is not a goal.

## Done when

- A user can build a process with branching transitions in the existing board UI
- Goals is expressed as data, `src/processes/goals/` is deleted, `goals.rs` is deleted
- Rust enforces the stage menu generically, with no per-process knowledge
- `npm run check` and `cargo check` pass
- No new runtime dependencies

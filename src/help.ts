// The sidebar's help block. "Getting Started" renders in-app from the Markdown below so a brand
// new install has it offline; the rest of the pages open on bees.bot, which is where they are
// maintained. ponytail: bundle the tutorials too only if people ask for them offline.

export const COMMUNITY_URL = "https://discord.gg/PTbcFnu4hS";

export const HELP_PAGES: { label: string; url: string }[] = [
  { label: "Getting started", url: "https://bees.bot/help/getting-started" },
  { label: "Why Bees.bot exists", url: "https://bees.bot/help/why-bees" },
  { label: "Ask the AI to build a process", url: "https://bees.bot/help/assistant-workflow" },
  { label: "A loop that escalates to a human", url: "https://bees.bot/help/escalation-loop" },
  { label: "The nine parts of an agent loop", url: "https://bees.bot/help/agent-loop" },
  { label: "The enterprise layer", url: "https://bees.bot/help/enterprise" },
  { label: "Building software with Bees", url: "https://bees.bot/help/software-development" },
  { label: "How Bees compares", url: "https://bees.bot/help/compare" },
  { label: "Core concepts", url: "https://bees.bot/docs/" }
];

export const GETTING_STARTED = `# Getting started

Bees is a desktop application. It works alone and offline; workspaces organize
teams and can share coordination — never documents — with invited teammates.

## 1. Join the community first

The people who build Bees are in the Discord alongside everyone else running
it, so setup questions, process design, and model choices get answered by
someone who has already solved them.

[Open the Discord](${COMMUNITY_URL})

## 2. Global settings

Open **Settings** from the gear beside the Bees.bot name at the top of this
sidebar. These settings belong to this computer and this person. They are never
synchronized, and they apply across every workspace and team you are signed
into. Credentials never leave the machine.

- **Local AI** — on-device models. Download one, then Run it. No network, no per-token cost.
- **AI CLI** — Codex through ChatGPT sign-in and optional agent runtimes you explicitly connect.
- **AI APIs** — API keys for hosted providers.
- **MCP servers** — manually configured remote MCP connections, each with its own tool allowlist.
- **Sign-ins** — accounts on this computer. Hold several at once and switch without signing out.
- **Workspaces** — create a workspace, keep it on this device if needed, and accept invitations.
- **Root Folder** — the folder every workspace and team folder is created under.
- **Theme** — appearance, including the light and dark presets the toolbar toggle switches between.

## 3. Workspaces

A workspace owns teams, people, licensing, and policy. New workspaces are ready
for teammates by default, even if you start on your own.

Turn on **Keep this workspace on this device only** during creation when you
need a private, device-only workspace. Only you can use it, nothing syncs, and
you cannot add team members to it later.

Documents always stay on your devices. Files never sync through Bees.

Workspaces are the badges at the top of the sidebar. Select **+** to add one,
or the gear on a workspace for its settings: **General**, **Members**,
**Invitations**, **Folder**, and **Knowledge**.

You can be signed into several accounts and several workspaces at once — the
company, a side project with a friend, or one kept on this device — without
their work, files, or credentials mixing.

## 4. Teams

A team is where the work lives: processes, boards, work items, agents, and one
folder on disk. Add one with **+** beside *Teams*. Hover a team for its
processes, new-task, and settings buttons. Under each team, the left menu lists
the primary task once for each currently running process run — opening one
shows that run's board. Planned or manually added subtasks stay inside it.

Team settings: **Members**, **Folder**, **Integrations** (Agent Plugins and skill
curation), **Browser**, **Archived**, and **Danger**.

## 5. Turn on at least one model

An agent cannot run without a model it can reach. Do this before building a
process — most "nothing happens when I press Run" comes from skipping it.

**Option A — a subscription you already pay for.** Connect Codex directly with
**Sign in** under **Settings → AI CLI**.
Claude Code remains an optional external agent: install it and explicitly choose
its binary there. Bees never scans your PATH or reads either tool's account files,
and every command it launches runs through the bundled sandbox runtime.

**Option B — an on-device model.** **Settings → Local AI**, select
**Download**, then **Run**. Nothing leaves the machine and there is no bill.
Small models are weaker at long instructions, so use them where privacy or
volume matters most.

**Option C — a provider API key.** **Settings → AI APIs**, add a key.

Every model picker lists exactly what this computer can run right now. An agent
naming a model this machine cannot reach is not eligible to run here, which is
how work routes to the right laptop instead of failing on the wrong one.

**Auto is the default on every process stage.** A stage left on *Auto* picks,
at the moment it starts, the first of these that this computer has: connected Codex
(ChatGPT), explicitly configured Claude Code, the largest downloaded local model,
the largest remote model. Name a model on the stage instead and that model is used,
with no substitution.

## 6. Folder structure

The workspace root is set at **Settings → Root Folder** and defaults to
\`<home>/Bees\`. Everything else is created underneath it:

\`\`\`
<root folder>/
  <workspace name>/
    <team name>/          the team folder
      agents/             one JSON file per agent
      plugins/team-skills/
        plugin.json       Agent Plugins 1.0.0 manifest
        skills/
          <slug>/SKILL.md a reusable Agent Skill
          .archive/       retired skills, never deleted
      ...                 approved outputs and your own documents
\`\`\`

Install portable packages under **Team settings → Integrations → Install
plugin**. A package has a root \`plugin.json\`, optional
\`skills/<name>/SKILL.md\`, and optional \`mcp.json\`. Bees validates the
manifest first, copies the package into app data, and makes its supported
skills and remote MCP servers available in the agent editor. Streamable HTTP
and legacy SSE servers are supported; stdio entries are skipped.

**Overriding a team folder.** A team folder defaults to
\`<workspace folder>/<team name>\`. When the real folder is elsewhere on this
machine — inside Google Drive, OneDrive, Dropbox, a Git checkout, a network
share — open **Team settings → Folder** and select **Choose override**. This is
per machine: the same team can be one path on your laptop and another on a
colleague's, and the work item's relative reference resolves on both.

**Shared files.** Bees does not synchronize documents. Keep using SharePoint,
Google Drive, Dropbox, Git, or a network share, and point the team folder at it.

**Linked locations.** Extra folders mapped on this machine, mounted for a run
under \`inputs/<location name>\` in the run workspace.

**The run workspace.** An agent never sees your disk. Each run gets a fresh
workspace with \`inputs/\` (staged copies of the item's files) and
\`outputs/\` (everything it writes, including \`.status\`). File access is
confined there. Commands can use local development tools through the bundled OS
sandbox, with network access limited to common package registries. Nothing reaches
the team folder until you approve it.

## 7. Your first process

A process is an ordered list of statuses, and an agent is bound to one status.
When a work item lands on a status that has an agent, that agent starts. That is
the whole engine — there is no process graph to draw.

Two processes ship ready to run. Open **Processes** from the icon beside a
team name:

- **Goals** — a goal is planned into subtasks, worked one at a time, and reviewed. Good for marketing, research, operations, and anything you repeat.
- **Code** — requirements, architecture, plan, implement, phase review, final review, done, against a local Git project.

Or build your own: **Workflows → Create workflow**, then a name and an ordered list
of statuses such as \`Brief, Draft, Review, Published\`.

Order matters in two ways. A run that writes no status moves the item to the
next status in order, and the **last** status marks the item done. Never put a
human waiting status last.

## 8. Your first run

1. Add a work item in the first column. The title is the goal; the description is the acceptance criteria, and it is the only thing a reviewing agent has to judge against later.
2. Press **Run** at the top of the dashboard. This starts the *process*, not that one task — from now on every item landing on a status with an agent starts itself. **Stop** is the brake.
3. Open the run and its **Files** panel. Every file the agent proposes waits there.
4. **Approve** copies the file into the team folder and adds it to the item's file list, so the next run can read it. **Reject** asks what should be different next time, and that reason is passed to the retry verbatim.
5. Once every proposed file is decided, the run checkpoints and the card moves on.

Everything needing your attention also collects under **Tasks waiting on you**
in this sidebar, so you do not have to watch boards.

## 9. Or just ask

The **Assistant** button in the top toolbar takes plain language and proposes
processes, statuses, agents, work items, and bulk changes as cards you read and
then apply. It can also drive the visible Bees interface for anything else,
including changing settings. Nothing is written until you press **Apply**.

## Where to go next

- [Why Bees.bot exists](https://bees.bot/help/why-bees)
- [A loop that escalates to a human](https://bees.bot/help/escalation-loop)
- [The nine parts of an agent loop](https://bees.bot/help/agent-loop)
- [The enterprise layer](https://bees.bot/help/enterprise)
- [All help and tutorials](https://bees.bot/help/)
`;

/**
 * Deliberately unkind demo data: titles too long, titles that repeat verbatim, a crowded stage, an
 * empty team. A layout that only survives three-word titles has not been tested.
 */

const NOW = "2026-08-13T09:00:00.000Z";

/** Fixed clock, so two screenshots of the same view do not differ for no reason. */
function at(minutesAgo) {
  return new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
}

const definition = (renderer, stateIds = {}) =>
  JSON.stringify({
    moduleId: null,
    version: 1,
    automation: "interactive",
    renderer,
    stateIds,
    capabilities: [],
    roleBindings: []
  });

/** Long enough to overflow a card, a table cell and a sidebar row — each clips differently. */
const LONG_TITLE =
  "Triage: Supermarket Full-Stack E-commerce Platform rebuild, fixed price INR 37,500 to 75,000, "
  + "skills PHP, Laravel, Vue, MySQL, Redis, Docker — client wants a written estimate first";

const REPEATED = "Find the best job right now and draft a proposal for it";

export function seedStatements() {
  const rows = [];
  const push = (sql, params = []) => rows.push({ sql, params });

  push(
    "INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["org-local", "Local org", at(9000), at(9000)]
  );
  push(
    "INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["org-acme", "Acme Robotics International", at(8000), at(8000)]
  );

  const teams = [
    ["team-dev", "org-local", "Developer"],
    ["team-marketing", "org-local", "Marketing"],
    // Empty on purpose: the empty state is a design surface, not an afterthought.
    ["team-ops", "org-local", "Operations"]
  ];
  for (const [id, org, name] of teams) {
    push(
      "INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, org, name, at(8000), at(8000)]
    );
  }

  const processes = [
    ["proc-bidding", "team-dev", "Bidding", "Win freelance work without reading every listing."],
    ["proc-lovable", "team-dev", "Developing lovable", ""],
    ["proc-goals", "team-marketing", "Goals", "Turn a goal into approved, executable tasks."]
  ];
  for (const [id, team, name, description] of processes) {
    push(
      "INSERT INTO processes (id, team_id, name, description, created_at, updated_at) "
      + "VALUES (?, ?, ?, ?, ?, ?)",
      [id, team, name, description, at(7000), at(7000)]
    );
    push(
      "INSERT INTO process_definitions (process_id, definition_json) VALUES (?, ?)",
      [id, definition("kanban")]
    );
  }

  const stages = [
    ["st-triage", "proc-bidding", "Triage", 0, 0],
    ["st-draft", "proc-bidding", "Draft", 1, 0],
    ["st-approval", "proc-bidding", "Awaiting approval", 2, 0],
    ["st-approved", "proc-bidding", "Approved", 3, 1],
    ["st-todo", "proc-lovable", "To do", 0, 0],
    ["st-doing", "proc-lovable", "In progress", 1, 0],
    ["st-done", "proc-lovable", "Done", 2, 1],
    ["st-plan", "proc-goals", "Plan", 0, 0],
    ["st-work", "proc-goals", "Work", 1, 0],
    ["st-waiting", "proc-goals", "Waiting", 2, 0],
    ["st-review", "proc-goals", "Review", 3, 0],
    ["st-gdone", "proc-goals", "Done", 4, 1]
  ];
  for (const [id, processId, name, position, terminal] of stages) {
    push(
      "INSERT INTO stages (id, process_id, name, position, is_terminal) VALUES (?, ?, ?, ?, ?)",
      [id, processId, name, position, terminal]
    );
  }

  const items = [
    ["wi-1", "proc-bidding", "st-triage", REPEATED, "", 5],
    ["wi-2", "proc-bidding", "st-triage", REPEATED, "", 12],
    ["wi-3", "proc-bidding", "st-triage", REPEATED, "", 20],
    ["wi-4", "proc-bidding", "st-triage", LONG_TITLE, "Client replied twice already.", 44],
    ["wi-5", "proc-bidding", "st-triage", "Triage: Custom Homepage Design and Build", "", 61],
    ["wi-6", "proc-bidding", "st-triage", "Write proposal: Customer portal, Django + HTMX", "", 90],
    ["wi-7", "proc-bidding", "st-draft", "Draft proposal: Shopify theme work, hourly USD 15–25", "", 30],
    [
      "wi-8", "proc-bidding", "st-approval",
      "Custom Homepage Build, hourly USD 15 to 25, skills PHP, WordPress, Elementor", "", 120
    ],
    ["wi-9", "proc-bidding", "st-approved", "Supermarket E-commerce Platform", "", 400],
    ["wi-10", "proc-lovable", "st-todo", "write a file hello.md that says hello from bees", "", 15],
    ["wi-11", "proc-lovable", "st-doing", "Ship the onboarding tour", "Three steps, no backdrop.", 70],
    [
      "wi-12", "proc-goals", "st-review",
      "Write a one page summary of what our bidding rules really are", "", 240
    ]
  ];
  for (const [id, processId, stageId, title, description, minutesAgo] of items) {
    push(
      "INSERT INTO work_items (id, process_id, stage_id, title, description, created_at, updated_at) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, processId, stageId, title, description, at(minutesAgo + 30), at(minutesAgo)]
    );
  }

  push(
    "INSERT INTO kanban_boards (id, team_id, process_id, name, stage_ids_json, created_at, updated_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      "board-bidding", "team-dev", "proc-bidding", "Bidding dashboard",
      JSON.stringify(["st-triage", "st-draft", "st-approval", "st-approved"]), at(7000), at(7000)
    ]
  );

  // One run per status the UI can show, so no status badge goes unrendered.
  const runs = [
    ["ex-1", "wi-1", "running", 4, null],
    ["ex-2", "wi-4", "completed", 42, at(40)],
    ["ex-3", "wi-7", "failed", 28, at(26)],
    ["ex-4", "wi-8", "queued", 2, null],
    ["ex-5", "wi-12", "cancelled", 230, at(228)],
    ["ex-6", "wi-10", "interrupted", 14, at(13)]
  ];
  for (const [id, workItemId, status, minutesAgo, endedAt] of runs) {
    push(
      "INSERT INTO executions (id, agent_id, work_item_id, runtime, status, conversation_id, "
      + "started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id, status === "queued" ? "bid-triage" : "proposal-writer", workItemId, "flue", status,
        `conv-${id}`, status === "queued" ? null : at(minutesAgo), endedAt, at(minutesAgo + 1)
      ]
    );
  }

  // Pending outputs are what puts a card in "Waiting for your approval".
  const outputs = [
    ["eo-1", "ex-2", "proposal.md", "proposals/"],
    ["eo-2", "ex-2", "estimate.csv", "proposals/"],
    ["eo-3", "ex-6", "hello.md", "notes/"]
  ];
  for (const [id, executionId, output, destination] of outputs) {
    push(
      "INSERT INTO execution_outputs (id, execution_id, logical_output, logical_destination, "
      + "status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      [id, executionId, output, destination, at(20)]
    );
  }

  return rows;
}

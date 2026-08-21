/**
 * Deliberately unkind demo data: titles too long, titles that repeat verbatim, a crowded stage, an
 * empty team. A layout that only survives three-word titles has not been tested.
 */

const NOW = "2026-08-13T09:00:00.000Z";

/** Fixed clock, so two screenshots of the same view do not differ for no reason. */
const at = (minutesAgo) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();

const definition = JSON.stringify({
  moduleId: null,
  version: 1,
  automation: "interactive",
  renderer: "kanban",
  stateIds: {},
  capabilities: [],
  roleBindings: []
});

/** Long enough to overflow a card, a table cell and a sidebar row — each clips differently. */
const LONG = "Triage: Supermarket Full-Stack E-commerce Platform rebuild, fixed price INR 37,500 to "
  + "75,000, skills PHP, Laravel, Vue, MySQL, Redis, Docker — client wants a written estimate first";
const REPEATED = "Find the best job right now and draft a proposal for it";

export function seedStatements() {
  const rows = [];
  const insert = (table, columns, values) => {
    const sql = `INSERT INTO ${table} (${columns}) VALUES (${columns.split(", ").map(() => "?").join(", ")})`;
    for (const params of values) rows.push({ sql, params });
  };

  insert("organizations", "id, name, created_at, updated_at", [
    ["org-local", "My workspace", at(9000), at(9000)],
    ["org-acme", "Acme Robotics International", at(8000), at(8000)]
  ]);

  // Operations is empty on purpose: the empty state is a design surface, not an afterthought.
  insert("teams", "id, organization_id, name, created_at, updated_at", [
    ["team-dev", "org-local", "Developer", at(8000), at(8000)],
    ["team-marketing", "org-local", "Marketing", at(8000), at(8000)],
    ["team-ops", "org-local", "Operations", at(8000), at(8000)]
  ]);

  insert("processes", "id, team_id, name, description, created_at, updated_at", [
    ["proc-bidding", "team-dev", "Bidding", "Win freelance work without reading every listing.", at(7000), at(7000)],
    ["proc-lovable", "team-dev", "Developing lovable", "", at(7000), at(7000)],
    ["proc-goals", "team-marketing", "Goals", "Turn a goal into approved, executable tasks.", at(7000), at(7000)]
  ]);
  insert("process_definitions", "process_id, definition_json",
    ["proc-bidding", "proc-lovable", "proc-goals"].map((id) => [id, definition]));

  insert("stages", "id, process_id, name, position, is_terminal", [
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
  ]);

  const item = (id, processId, stageId, title, description, ago) =>
    [id, processId, stageId, title, description, at(ago + 30), at(ago)];
  insert("work_items", "id, process_id, stage_id, title, description, created_at, updated_at", [
    item("wi-1", "proc-bidding", "st-triage", REPEATED, "", 5),
    item("wi-2", "proc-bidding", "st-triage", REPEATED, "", 12),
    item("wi-3", "proc-bidding", "st-triage", REPEATED, "", 20),
    item("wi-4", "proc-bidding", "st-triage", LONG, "Client replied twice already.", 44),
    item("wi-5", "proc-bidding", "st-triage", "Triage: Custom Homepage Design and Build", "", 61),
    item("wi-6", "proc-bidding", "st-triage", "Write proposal: Customer portal, Django + HTMX", "", 90),
    item("wi-7", "proc-bidding", "st-draft", "Draft proposal: Shopify theme work, hourly USD 15–25", "", 30),
    item("wi-8", "proc-bidding", "st-approval", "Custom Homepage Build, hourly USD 15 to 25, skills PHP, WordPress, Elementor", "", 120),
    item("wi-9", "proc-bidding", "st-approved", "Supermarket E-commerce Platform", "", 400),
    item("wi-10", "proc-lovable", "st-todo", "write a file hello.md that says hello from bees", "", 15),
    item("wi-11", "proc-lovable", "st-doing", "Ship the onboarding tour", "Three steps, no backdrop.", 70),
    item("wi-12", "proc-goals", "st-review", "Write a one page summary of what our bidding rules really are", "", 240)
  ]);

  insert("kanban_boards", "id, team_id, process_id, name, stage_ids_json, created_at, updated_at", [
    ["board-bidding", "team-dev", "proc-bidding", "Bidding dashboard",
      JSON.stringify(["st-triage", "st-draft", "st-approval", "st-approved"]), at(7000), at(7000)]
  ]);

  // One run per status the UI can show, so no status badge goes unrendered.
  const run = (id, workItemId, status, ago, endedAt) =>
    [id, status === "queued" ? "bid-triage" : "proposal-writer", workItemId, "dsh", status,
      `conv-${id}`, status === "queued" ? null : at(ago), endedAt, at(ago + 1)];
  insert("executions",
    "id, agent_id, work_item_id, runtime, status, conversation_id, started_at, ended_at, created_at", [
      run("ex-1", "wi-1", "running", 4, null),
      run("ex-2", "wi-4", "completed", 42, at(40)),
      run("ex-3", "wi-7", "failed", 28, at(26)),
      run("ex-4", "wi-8", "queued", 2, null),
      run("ex-5", "wi-12", "cancelled", 230, at(228)),
      run("ex-6", "wi-10", "interrupted", 14, at(13))
    ]);

  insert("execution_outputs",
    "id, execution_id, logical_output, logical_destination, status, created_at", [
      ["eo-1", "ex-2", "proposal.md", "proposals/", "pending", at(20)],
      ["eo-2", "ex-2", "estimate.csv", "proposals/", "pending", at(20)],
      ["eo-3", "ex-6", "hello.md", "notes/", "pending", at(20)]
    ]);

  return rows;
}

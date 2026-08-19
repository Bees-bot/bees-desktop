import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("creates the complete fresh-install schema", () => {
  const database = new DatabaseSync(":memory:");
  const schema = fileURLToPath(new URL("../src-tauri/schema.sql", import.meta.url));
  database.exec(readFileSync(schema, "utf8"));

  expect(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(({ name }) => name)
  ).toEqual([
    "conversation_purges",
    "execution_outputs",
    "executions",
    "file_location_mappings",
    "file_locations",
    "kanban_boards",
    "organizations",
    "process_definitions",
    "processes",
    "registries",
    // FTS5 expands `search_index` into its own shadow tables; they are the index, not schema.
    "search_index",
    "search_index_config",
    "search_index_content",
    "search_index_data",
    "search_index_docsize",
    "search_index_idx",
    "settings",
    "skill_usage",
    "software_project_mappings",
    "stages",
    "sync_queue",
    "sync_state",
    "tags",
    "team_folder_mappings",
    "teams",
    "work_items"
  ]);
  expect(
    database.prepare("SELECT name FROM pragma_table_info('executions') ORDER BY cid").all()
  ).toContainEqual({ name: "conversation_id" });
  expect(
    database.prepare("SELECT name FROM pragma_table_info('execution_outputs') ORDER BY cid").all()
  ).toContainEqual({ name: "reason" });
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_work_items_%goal_key' ORDER BY name")
      .all()
      .map(({ name }) => name)
  ).toEqual(["idx_work_items_child_goal_key", "idx_work_items_root_goal_key"]);

  database.close();
});

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_folder_mappings (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1))
);

-- Names and scopes are coordination metadata. Absolute paths live only in the mapping table.
CREATE TABLE IF NOT EXISTS file_locations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_location_mappings (
  location_id TEXT PRIMARY KEY REFERENCES file_locations(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1))
);

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  completion_rules TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  UNIQUE (process_id, position)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id),
  stage_id TEXT NOT NULL REFERENCES stages(id),
  parent_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked', 'done', 'archived')),
  logical_files_json TEXT NOT NULL DEFAULT '[]',
  sync_version INTEGER NOT NULL DEFAULT 0,
  checkpoint_stage_id TEXT,
  checkpoint_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Software source stays outside the synced team folder. Only this device knows its paths.
CREATE TABLE IF NOT EXISTS software_project_mappings (
  work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  project_branch TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1))
);

CREATE TABLE IF NOT EXISTS kanban_boards (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stage_ids_json TEXT NOT NULL,
  filters_json TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{"prompt":""}',
  work_item_id TEXT NOT NULL REFERENCES work_items(id),
  runtime TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')
  ),
  conversation_id TEXT NOT NULL,
  instance_uid TEXT,
  submission_id TEXT,
  workspace_ref TEXT,
  conversation_snapshot_json TEXT,
  conversation_text TEXT,
  result_json TEXT,
  usage_json TEXT,
  model_json TEXT,
  logs TEXT NOT NULL DEFAULT '',
  error_text TEXT,
  restarted_from_execution_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_outputs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  logical_output TEXT NOT NULL,
  logical_destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (execution_id, logical_output)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('hourly', 'daily', 'weekdays')),
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registries (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  files_json TEXT NOT NULL DEFAULT '[]',
  copied_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  scope TEXT PRIMARY KEY,
  cursor TEXT,
  last_synced_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_purges (
  conversation_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT
);

-- When each skill was last put in front of a model, and how often. The only signal the
-- curator has: Bees scores no run, so "nobody has used this in months" is what stands in
-- for "this skill is not earning its place".
CREATE TABLE IF NOT EXISTS skill_usage (
  team_id TEXT NOT NULL,
  capability_ref TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (team_id, capability_ref)
);

-- One searchable record of the team's own work: what people wrote on items, and what agents
-- said in settled runs. Team scope is resolved by joining back to the real rows, so the index
-- itself carries no permission logic and cannot leak a row the caller could not already read.
--
-- ponytail: an ordinary FTS5 table, not `content=`. It duplicates the indexed text, which for
-- conversations is the larger half of the row — but the index would have cost most of that
-- anyway, and this keeps one table, one bm25 ranking, and a backfill that is a plain INSERT.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  title,
  body
);

CREATE TRIGGER IF NOT EXISTS work_items_search_insert AFTER INSERT ON work_items BEGIN
  INSERT INTO search_index (kind, ref_id, title, body)
  VALUES ('work_item', new.id, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS work_items_search_update
AFTER UPDATE OF title, description ON work_items BEGIN
  DELETE FROM search_index WHERE kind = 'work_item' AND ref_id = old.id;
  INSERT INTO search_index (kind, ref_id, title, body)
  VALUES ('work_item', new.id, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS work_items_search_delete AFTER DELETE ON work_items BEGIN
  DELETE FROM search_index WHERE kind = 'work_item' AND ref_id = old.id;
END;

-- Runs enter the index only when they settle: `conversation_text` is the redacted projection
-- written by `saveConversationSnapshot`, so reasoning never reaches the index.
CREATE TRIGGER IF NOT EXISTS executions_search_update
AFTER UPDATE OF conversation_text ON executions BEGIN
  DELETE FROM search_index WHERE kind = 'execution' AND ref_id = old.id;
  INSERT INTO search_index (kind, ref_id, title, body)
  SELECT 'execution', new.id, '', new.conversation_text WHERE new.conversation_text IS NOT NULL;
END;

CREATE TRIGGER IF NOT EXISTS executions_search_delete AFTER DELETE ON executions BEGIN
  DELETE FROM search_index WHERE kind = 'execution' AND ref_id = old.id;
END;

-- One-time backfill for databases that predate the index. The marker is checked rather than
-- the index itself: after the first INSERT the index is no longer empty, so emptiness cannot
-- guard the second statement.
INSERT INTO search_index (kind, ref_id, title, body)
SELECT 'work_item', id, title, description FROM work_items
WHERE deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'search_index_backfilled');

INSERT INTO search_index (kind, ref_id, title, body)
SELECT 'execution', id, '', conversation_text FROM executions
WHERE conversation_text IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'search_index_backfilled');

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
VALUES ('search_index_backfilled', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE INDEX IF NOT EXISTS idx_stages_process ON stages(process_id, position);
CREATE INDEX IF NOT EXISTS idx_file_locations_org_team ON file_locations(organization_id, team_id, name);
CREATE INDEX IF NOT EXISTS idx_work_items_stage ON work_items(stage_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_kanban_boards_team ON kanban_boards(team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_executions_work_item ON executions(work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_agent ON executions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_restarted_from ON executions(restarted_from_execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_outputs_status ON execution_outputs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_registries_team ON registries(team_id, name);
CREATE INDEX IF NOT EXISTS idx_sync_queue_due ON sync_queue(next_attempt_at);

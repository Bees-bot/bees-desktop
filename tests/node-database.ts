import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";

// Tauri hands the running app these four paths; a throwaway folder stands in for it here.
const root = mkdtempSync(join(tmpdir(), "bees-test-"));
process.env.BEES_APP_DATA ??= root;
process.env.BEES_DATA_DIR ??= root;
process.env.BEES_STATE_DIR ??= root;
process.env.BEES_DATABASE_PATH ??= join(root, "bees-stage1.db");

export class NodeDatabase {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    initializeProductDatabase(this.connection);
  }
}

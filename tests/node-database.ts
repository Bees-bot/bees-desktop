import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";

// the app hands over these folders and writes its device id; a throwaway folder stands in here
const root = mkdtempSync(join(tmpdir(), "bees-test-"));
for (const name of ["BEES_APP_DATA", "BEES_DATA_DIR", "BEES_STATE_DIR"]) process.env[name] ??= root;
writeFileSync(join(process.env.BEES_APP_DATA!, "device-id"), "test-device");

export class NodeDatabase {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    initializeProductDatabase(this.connection);
  }
}

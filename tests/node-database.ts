import { DatabaseSync } from "node:sqlite";
import { initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";

export class NodeDatabase {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    initializeProductDatabase(this.connection);
  }
}

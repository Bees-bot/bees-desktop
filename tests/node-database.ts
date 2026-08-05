import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Database,
  DatabaseStatement,
  DatabaseValue
} from "../src/database.js";

function sqlValues(values: DatabaseValue[]): SQLInputValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    if (typeof value === "boolean") return Number(value);
    return JSON.stringify(value);
  });
}

export class NodeDatabase implements Database {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    const schema = fileURLToPath(new URL("../src-tauri/schema.sql", import.meta.url));
    this.connection.exec(readFileSync(schema, "utf8"));
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: DatabaseValue[] = []
  ): Promise<T[]> {
    return this.connection.prepare(sql).all(...sqlValues(params)) as T[];
  }

  async execute(sql: string, params: DatabaseValue[] = []): Promise<number> {
    return Number(this.connection.prepare(sql).run(...sqlValues(params)).changes);
  }

  async transaction(statements: DatabaseStatement[]): Promise<number[]> {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result: number[] = [];
      for (const { sql, params = [] } of statements) {
        result.push(await this.execute(sql, params));
      }
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}

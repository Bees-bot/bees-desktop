import { invoke } from "@tauri-apps/api/core";

export type DatabaseValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface DatabaseStatement {
  sql: string;
  params?: DatabaseValue[];
}

export interface Database {
  query<T extends Record<string, unknown>>(sql: string, params?: DatabaseValue[]): Promise<T[]>;
  execute(sql: string, params?: DatabaseValue[]): Promise<number>;
  transaction(statements: DatabaseStatement[]): Promise<number[]>;
}

export class TauriDatabase implements Database {
  query<T extends Record<string, unknown>>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
    return invoke<T[]>("db_query", { sql, params });
  }

  execute(sql: string, params: DatabaseValue[] = []): Promise<number> {
    return invoke<number>("db_execute", { sql, params });
  }

  transaction(statements: DatabaseStatement[]): Promise<number[]> {
    return invoke<number[]>("db_transaction", {
      statements: statements.map(({ sql, params = [] }) => ({ sql, params }))
    });
  }
}


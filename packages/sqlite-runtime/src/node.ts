import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  createSqliteDriver,
  wrapSqliteStatement,
  type SqliteDbOpts,
} from "./sqlite-db";
import type {
  SqliteDriver,
  SqliteParameters,
  SqliteStatement,
} from "./sqlite-driver";

export * from "./index";

export class NodeSqliteDriver implements SqliteDriver {
  constructor(private readonly database: DatabaseSync) {}

  run(sql: string) {
    this.database.exec(sql);
  }

  query<Row>(sql: string): SqliteStatement<Row> {
    return wrapSqliteStatement(this.database.prepare(sql), normalizeParameters);
  }

  close() {
    this.database.close();
  }
}

function normalizeParameters(
  parameters: SqliteParameters
): Record<string, SQLInputValue> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [
      name,
      typeof value === "boolean" ? Number(value) : value,
    ])
  );
}

export function createSqliteDb(opts?: SqliteDbOpts) {
  return createSqliteDriver(
    (path) => new NodeSqliteDriver(new DatabaseSync(path)),
    opts
  );
}

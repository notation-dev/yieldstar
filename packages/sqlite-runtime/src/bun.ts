import { Database } from "bun:sqlite";
import {
  createSqliteDriver,
  wrapSqliteStatement,
  type SqliteDbOpts,
} from "./sqlite-db";
import type { SqliteDriver, SqliteStatement } from "./sqlite-driver";

export * from "./index";

export class BunSqliteDriver implements SqliteDriver {
  constructor(private readonly database: Database) {}

  run(sql: string) {
    this.database.run(sql);
  }

  query<Row>(sql: string): SqliteStatement<Row> {
    return wrapSqliteStatement(this.database.query(sql));
  }

  close() {
    this.database.close();
  }
}

export function createSqliteDb(opts?: SqliteDbOpts) {
  return createSqliteDriver(
    (path) => new BunSqliteDriver(new Database(path, { create: true })),
    opts
  );
}

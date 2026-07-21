import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  SqliteDriver,
  SqliteParameters,
  SqliteRunResult,
  SqliteStatement,
} from "./sqlite-driver";

export type SqliteDbOpts = {
  /**
   * Path to the SQLite database file
   * @default "./.db/yieldstar.sqlite"
   */
  path?: string;
  /**
   * Enable Write-Ahead Logging (WAL) mode.
   * Recommended for better performance and concurrency.
   * @default true
   */
  wal?: boolean;
};

const defaultOpts: Required<SqliteDbOpts> = {
  path: "./.db/yieldstar.sqlite",
  wal: true,
};

export function createSqliteDriver<Driver extends SqliteDriver>(
  create: (path: string) => Driver,
  opts?: SqliteDbOpts
) {
  const mergedOpts = { ...defaultOpts, ...opts };
  mkdirSync(dirname(mergedOpts.path), { recursive: true });

  const db = create(mergedOpts.path);
  if (mergedOpts.wal) {
    db.run("PRAGMA journal_mode = WAL");
  }
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/** The native prepared-statement shape connectors adapt to SqliteStatement. */
type NativeStatement = {
  get(parameters?: any): unknown;
  all(parameters?: any): unknown[];
  run(parameters?: any): SqliteRunResult;
};

/**
 * Adapt a native prepared statement to the SqliteStatement contract: bind
 * parameters are only passed when provided, with `bind` mapping them to the
 * native driver's binding shape.
 */
export function wrapSqliteStatement<Row>(
  statement: NativeStatement,
  bind: (parameters: SqliteParameters) => any = (parameters) => parameters
): SqliteStatement<Row> {
  return {
    get: (parameters) =>
      (parameters ? statement.get(bind(parameters)) : statement.get()) as
        | Row
        | undefined,
    all: (parameters) =>
      (parameters ? statement.all(bind(parameters)) : statement.all()) as Row[],
    run: (parameters) =>
      parameters ? statement.run(bind(parameters)) : statement.run(),
  };
}

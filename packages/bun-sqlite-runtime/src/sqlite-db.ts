import { mkdirSync } from "node:fs";
import { dirname } from "path";
import { Database } from "bun:sqlite";

type SqliteDbOpts = {
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

/**
 * Create a new sqlite database
 * @param opts - Options for the sqlite database
 * @returns A new sqlite database
 */
export function createSqliteDb(opts?: SqliteDbOpts) {
  const mergedOpts = { ...defaultOpts, ...opts };
  const dirPath = dirname(mergedOpts.path);

  mkdirSync(dirPath, { recursive: true });

  const db = new Database(mergedOpts.path, { create: true });

  if (mergedOpts.wal) {
    db.run("PRAGMA journal_mode = WAL");
  }

  return db;
}

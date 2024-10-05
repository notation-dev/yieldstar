import { SqliteEventLoop, createSqliteDb } from "yieldstar-sqlite-bun";

export const runtimeDb = await createSqliteDb("./.db/http-server.sqlite");

export const sqliteEventLoop = new SqliteEventLoop(runtimeDb);

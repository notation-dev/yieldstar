import { createWorkflowRouter } from "yieldstar";
import { simpleWorkflow } from "../workflows/simple";
import { SqliteEventLoop, createSqliteDb } from "yieldstar-runtime-bun-sqlite";

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
});

export const runtimeDb = await createSqliteDb("./.db/http-server.sqlite");

export const sqliteEventLoop = new SqliteEventLoop(runtimeDb);

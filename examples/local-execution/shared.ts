import { createWorkflowRouter } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/bun-sqlite-runtime";
import { simpleWorkflow } from "../workflows/simple";

export const runtimeDb = await createSqliteDb("./.db/http-server.sqlite");
export const sqliteEventLoop = new SqliteEventLoop(runtimeDb);

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
});

import { createWorkflowRouter } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/bun-sqlite-runtime";
import { simpleWorkflow } from "../workflows/simple";
import { dynamicWorkflow } from "../workflows/dynamic";

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
  "dynamic-workflow": dynamicWorkflow,
});

export const runtimeDb = await createSqliteDb("./.db/http-server.sqlite");

export const sqliteEventLoop = new SqliteEventLoop(runtimeDb);

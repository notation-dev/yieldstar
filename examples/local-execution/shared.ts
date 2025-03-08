import { createWorkflowRouter } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/bun-sqlite-runtime";
import { simpleWorkflow } from "../workflows/simple";
import { dynamicWorkflow } from "../workflows/dynamic";

export const runtimeDb = createSqliteDb({
  path: "./.db/local-execution.sqlite",
});
export const sqliteEventLoop = new SqliteEventLoop(runtimeDb);

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
  "dynamic-workflow": dynamicWorkflow,
});

export type WorkflowRouter = typeof workflowRouter;

import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowWorker } from "yieldstar-bun-server";
import {
  SqliteScheduler,
  SqlitePersister,
  SqliteTaskQueueClient,
} from "yieldstar-sqlite-bun";
import { workflowRouter } from "./router";
import { runtimeDb } from "./runtime";
import { SqliteTimersClient } from "yieldstar-sqlite-bun/src/sqlite-timers";

const workflowRunner = new WorkflowRunner({
  persister: new SqlitePersister(runtimeDb),
  scheduler: new SqliteScheduler({
    taskQueueClient: new SqliteTaskQueueClient(runtimeDb),
    timersClient: new SqliteTimersClient(runtimeDb),
  }),
  router: workflowRouter,
});

const logger = pino();
const worker = createWorkflowWorker(workflowRunner, logger);

worker.listen();

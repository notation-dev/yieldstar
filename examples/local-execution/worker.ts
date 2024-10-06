import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowWorker } from "../../packages/@yieldstar/bun-workers-invokers/src";
import {
  SqliteScheduler,
  SqlitePersister,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/bun-sqlite-runtime";
import { runtimeDb, workflowRouter } from "./shared";

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

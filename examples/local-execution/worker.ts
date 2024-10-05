import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowWorker } from "yieldstar-manager-bun-workers";
import {
  SqliteScheduler,
  SqlitePersister,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "yieldstar-runtime-bun-sqlite";
import { workflowRouter } from "./router";
import { runtimeDb } from "./runtime";

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

import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import {
  SqliteSchedulerClient,
  SqliteHeapClient,
  SqliteStoreClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/sqlite-runtime/bun";
import { runtimeDb, workflowRouter } from "./shared";

const logger = pino();

const heapClient = new SqliteHeapClient(runtimeDb);
const schedulerClient = new SqliteSchedulerClient({
  taskQueueClient: new SqliteTaskQueueClient(runtimeDb),
  timersClient: new SqliteTimersClient(runtimeDb),
});
const storeClient = new SqliteStoreClient({
  db: runtimeDb,
  schedulerClient,
});

const workflowRunner = new WorkflowRunner({
  router: workflowRouter,
  heapClient,
  schedulerClient,
  storeClient,
  logger,
});

const worker = createWorkflowWorker(workflowRunner, logger);

worker.listen();

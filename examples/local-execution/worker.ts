import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import {
  SqliteSchedulerClient,
  SqliteHeapClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/bun-sqlite-runtime";
import { runtimeDb, workflowRouter } from "./shared";

const logger = pino();

const heapClient = new SqliteHeapClient(runtimeDb);
const schedulerClient = new SqliteSchedulerClient({
  taskQueueClient: new SqliteTaskQueueClient(runtimeDb),
  timersClient: new SqliteTimersClient(runtimeDb),
});

const workflowRunner = new WorkflowRunner({
  router: workflowRouter,
  heapClient,
  schedulerClient,
  logger,
});

const worker = createWorkflowWorker(workflowRunner, logger);

worker.listen();

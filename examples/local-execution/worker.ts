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

const workflowRunner = new WorkflowRunner({
  heapClient: new SqliteHeapClient(runtimeDb),
  schedulerClient: new SqliteSchedulerClient({
    taskQueueClient: new SqliteTaskQueueClient(runtimeDb),
    timersClient: new SqliteTimersClient(runtimeDb),
  }),
  router: workflowRouter,
});

const logger = pino();
const worker = createWorkflowWorker(workflowRunner, logger);

worker.listen();

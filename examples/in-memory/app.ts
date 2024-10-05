import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowManager } from "yieldstar-test-manager";
import {
  MemoryEventLoop,
  MemoryScheduler,
  MemoryPersister,
} from "yieldstar-test-runtime";
import { createLocalSdk } from "yieldstar";
import { workflowRouter } from "./router";

const logger = pino();
const memoryEventLoop = new MemoryEventLoop();

const workflowRunner = new WorkflowRunner({
  persister: new MemoryPersister(),
  scheduler: new MemoryScheduler(memoryEventLoop),
  router: workflowRouter,
});

const manager = createWorkflowManager({
  runner: workflowRunner,
  logger,
});

const sdk = createLocalSdk(workflowRouter, manager);

memoryEventLoop.start({ onNewTask: manager.execute });

try {
  const result = await sdk.triggerAndWait("polling");
  console.log(result);
} finally {
  memoryEventLoop.stop();
}

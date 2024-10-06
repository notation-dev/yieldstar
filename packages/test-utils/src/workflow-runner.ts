import type { WorkflowGenerator } from "@yieldstar/core";
import type { Logger } from "pino";
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowInvoker } from "@yieldstar/test-invoker";
import {
  MemoryEventLoop,
  MemorySchedulerClient,
  MemoryHeapClient,
} from "@yieldstar/test-runtime";
import { createLocalSdk } from "yieldstar";

export function createWorkflowTestRunner(params?: { logger?: Logger }) {
  const logger = params?.logger ?? pino({ level: "error" });

  return {
    async triggerAndWait<T>(workflow: WorkflowGenerator<T>): Promise<T> {
      const workflowRouter = { workflow };
      const memoryEventLoop = new MemoryEventLoop();

      const workflowRunner = new WorkflowRunner({
        heapClient: new MemoryHeapClient(),
        schedulerClient: new MemorySchedulerClient(memoryEventLoop),
        router: workflowRouter,
      });

      const invoker = createWorkflowInvoker({
        runner: workflowRunner,
        logger,
      });

      memoryEventLoop.start({ onNewTask: invoker.execute });

      const sdk = createLocalSdk(workflowRouter, invoker);
      const result = await sdk.triggerAndWait("workflow");

      memoryEventLoop.stop();
      return result;
    },
  };
}

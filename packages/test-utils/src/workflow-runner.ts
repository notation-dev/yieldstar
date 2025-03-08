import type {
  WorkflowGenerator,
  TriggerEvent,
  WorkflowGeneratorReturnType,
} from "@yieldstar/core";
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

export function createWorkflowTestRunner(opts?: { logger?: Logger }) {
  const logger = opts?.logger ?? pino({ level: "error" });

  return {
    async triggerAndWait<Workflow extends WorkflowGenerator<any, any>>(
      workflow: Workflow,
      event?: TriggerEvent<Parameters<Workflow>[0]>
    ): Promise<WorkflowGeneratorReturnType<Workflow>> {
      const workflowRouter = { workflow };
      const memoryEventLoop = new MemoryEventLoop(logger);

      const workflowRunner = new WorkflowRunner({
        heapClient: new MemoryHeapClient(),
        schedulerClient: new MemorySchedulerClient(memoryEventLoop),
        router: workflowRouter,
        logger,
      });

      const invoker = createWorkflowInvoker({
        runner: workflowRunner,
        logger,
      });

      memoryEventLoop.start({ onNewEvent: invoker.execute });

      const sdk = createLocalSdk<typeof workflowRouter>(invoker);
      const result = await sdk.triggerAndWait("workflow", event);

      memoryEventLoop.stop();

      return result;
    },
  };
}

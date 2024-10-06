import type { CompositeStepGenerator } from "yieldstar";
import type { Logger } from "pino";
import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowInvoker } from "yieldstar-test-invoker";
import {
  MemoryEventLoop,
  MemoryScheduler,
  MemoryPersister,
} from "yieldstar-test-runtime";
import { createLocalSdk } from "yieldstar";

export function createWorkflowTestRunner(params?: { logger?: Logger }) {
  const logger = params?.logger ?? pino({ level: "error" });

  return {
    async triggerAndWait<T>(workflow: CompositeStepGenerator<T>): Promise<T> {
      const workflowRouter = { workflow };
      const memoryEventLoop = new MemoryEventLoop();

      const workflowRunner = new WorkflowRunner({
        persister: new MemoryPersister(),
        scheduler: new MemoryScheduler(memoryEventLoop),
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

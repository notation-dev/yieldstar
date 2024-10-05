import type { CompositeStepGenerator } from "yieldstar";
import type { Logger } from "pino";
import pino from "pino";
import { WorkflowRunner } from "yieldstar";
import { createWorkflowManager } from "yieldstar-test-manager";
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

      const manager = createWorkflowManager({
        runner: workflowRunner,
        logger,
      });

      memoryEventLoop.start({ onNewTask: manager.execute });

      const sdk = createLocalSdk(workflowRouter, manager);
      const result = await sdk.triggerAndWait("workflow");

      memoryEventLoop.stop();
      return result;
    },
  };
}

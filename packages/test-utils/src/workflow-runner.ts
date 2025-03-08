import type {
  WorkflowRouter,
  TriggerEvent,
  WorkflowGeneratorReturnType,
  EventParamsOf,
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

export function createTestSdkFactory(params?: { logger?: Logger }) {
  const logger = params?.logger ?? pino({ level: "error" });

  return <W extends WorkflowRouter>(workflowRouter: W) => {
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

    return {
      async triggerAndWait<
        K extends keyof W & string,
        EventParams = EventParamsOf<W[K]>
      >(
        event: TriggerEvent<K, EventParams>
      ): Promise<WorkflowGeneratorReturnType<W[K]>> {
        memoryEventLoop.start({ onNewEvent: invoker.execute });

        const sdk = createLocalSdk<typeof workflowRouter>(invoker);
        const result = await sdk.triggerAndWait(event);

        memoryEventLoop.stop();
        memoryEventLoop.reset();

        return result;
      },
    };
  };
}

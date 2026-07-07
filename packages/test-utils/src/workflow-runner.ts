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
  MemoryStoreClient,
} from "@yieldstar/test-runtime";
import { createLocalSdk } from "yieldstar";

export function createTestSdkFactory(params?: { logger?: Logger }) {
  const logger = params?.logger ?? pino({ level: "error" });

  return <W extends WorkflowRouter>(workflowRouter: W) => {
    const memoryEventLoop = new MemoryEventLoop(logger);
    const schedulerClient = new MemorySchedulerClient(memoryEventLoop);
    const storeClient = new MemoryStoreClient({ schedulerClient });

    const workflowRunner = new WorkflowRunner({
      heapClient: new MemoryHeapClient(),
      schedulerClient,
      storeClient,
      router: workflowRouter,
      logger,
    });

    const invoker = createWorkflowInvoker({
      runner: workflowRunner,
      logger,
    });

    return {
      async trigger<
        K extends keyof W & string,
        Params extends EventParamsOf<W[K]> = EventParamsOf<W[K]>
      >(
        event: TriggerEvent<K, Params>
      ): Promise<void> {
        const executionEvent = {
          executionId: event.executionId ?? crypto.randomUUID(),
          workflowId: event.workflowId,
          params: event.params,
        };
        await invoker.execute(executionEvent);
      },
      async triggerAndWait<
        K extends keyof W & string,
        Params extends EventParamsOf<W[K]> = EventParamsOf<W[K]>
      >(
        event: TriggerEvent<K, Params>
      ): Promise<WorkflowGeneratorReturnType<W[K]>> {
        memoryEventLoop.start({ onNewEvent: invoker.execute });

        const sdk = createLocalSdk<typeof workflowRouter>(invoker);
        const result = await sdk.triggerAndWait(event);

        memoryEventLoop.stop();
        memoryEventLoop.reset();

        return result;
      },
      store: storeClient.store.bind(storeClient),
      storeClient,
    };
  };
}

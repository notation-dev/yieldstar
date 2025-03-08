import type {
  EventParamsOf,
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  WorkflowInvoker,
  TriggerEvent,
  ExecutionEvent,
} from "@yieldstar/core";
import { randomUUIDv7 } from "bun";

export function createLocalSdk<W extends WorkflowRouter>(
  invoker: WorkflowInvoker
) {
  return {
    async trigger<K extends string & keyof W>(
      event: TriggerEvent<K, EventParamsOf<W[K]>>
    ) {
      const executionEvent: ExecutionEvent = {
        executionId: event.executionId ?? randomUUIDv7(),
        workflowId: event.workflowId,
        params: event.params,
      };
      await invoker.execute(executionEvent);
      return { executionId: executionEvent.executionId };
    },
    async triggerAndWait<K extends string & keyof W>(
      event: TriggerEvent<K, EventParamsOf<W[K]>>
    ) {
      const executionId = event.executionId ?? randomUUIDv7();
      const workflowCompletePromise = new Promise((resolve) => {
        invoker.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger({ ...event, executionId });
      return workflowCompletePromise as Promise<
        WorkflowGeneratorReturnType<W[K]>
      >;
    },
  };
}

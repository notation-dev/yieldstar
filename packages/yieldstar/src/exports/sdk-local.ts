import type {
  EventParamsOf,
  WorkflowRouter,
  WorkflowInvoker,
  TriggerEvent,
  ExecutionEvent,
} from "@yieldstar/core";
import { nanoid } from "nanoid";
import type { TriggerAck, WorkflowResult } from "../internal/types";

export function createLocalSdk<W extends WorkflowRouter>(
  invoker: WorkflowInvoker
) {
  return {
    async trigger<K extends string & keyof W>(
      event: TriggerEvent<K, EventParamsOf<W[K]>>
    ): TriggerAck {
      const executionEvent: ExecutionEvent = {
        executionId: event.executionId ?? nanoid(),
        workflowId: event.workflowId,
        params: event.params,
      };
      await invoker.execute(executionEvent);
      return { executionId: executionEvent.executionId };
    },
    async triggerAndWait<K extends string & keyof W>(
      event: TriggerEvent<K, EventParamsOf<W[K]>>
    ): WorkflowResult<W, K> {
      const executionId = event.executionId ?? nanoid();
      const workflowCompletePromise = new Promise((resolve) => {
        invoker.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger({ ...event, executionId });
      return workflowCompletePromise as WorkflowResult<W, K>;
    },
  };
}

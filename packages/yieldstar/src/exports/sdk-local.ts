import type {
  EventParamsOfWorkflow,
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  WorkflowInvoker,
  TriggerEvent,
  ExecutionEvent,
} from "@yieldstar/core";
import { randomUUID } from "node:crypto";

export function createLocalSdk<W extends WorkflowRouter>(
  invoker: WorkflowInvoker
) {
  return {
    async trigger<K extends keyof W>(
      workflowId: K,
      triggerEvent?: TriggerEvent<EventParamsOfWorkflow<W[K]>>
    ) {
      const executionEvent: ExecutionEvent = {
        executionId: triggerEvent?.executionId ?? randomUUID(),
        workflowId: workflowId as string,
        params: triggerEvent?.params,
      };
      await invoker.execute(executionEvent);
      return { executionId: executionEvent.executionId };
    },
    async triggerAndWait<K extends keyof W>(
      workflowId: K,
      triggerEvent?: TriggerEvent<EventParamsOfWorkflow<W[K]>>
    ) {
      const executionId = triggerEvent?.executionId ?? randomUUID();
      const workflowCompletePromise = new Promise((resolve) => {
        invoker.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger(workflowId, { ...triggerEvent, executionId });
      return workflowCompletePromise as Promise<
        WorkflowGeneratorReturnType<W[K]>
      >;
    },
  };
}

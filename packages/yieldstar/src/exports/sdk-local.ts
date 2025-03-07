import type {
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  WorkflowInvoker,
  TriggerEvent,
} from "@yieldstar/core";
import { randomUUID } from "node:crypto";

export function createLocalSdk<W extends WorkflowRouter>(
  invoker: WorkflowInvoker
) {
  return {
    async trigger<K extends keyof W>(workflowId: K, event?: TriggerEvent) {
      const executionId = event?.executionId ?? randomUUID();
      await invoker.execute({
        executionId,
        workflowId: workflowId as string,
        params: event?.params ?? {},
      });
      return { executionId };
    },
    async triggerAndWait<K extends keyof W>(
      workflowId: K,
      event?: TriggerEvent
    ) {
      const executionId = event?.executionId ?? randomUUID();
      const workflowCompletePromise = new Promise((resolve) => {
        invoker.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger(workflowId, event);
      return workflowCompletePromise as Promise<
        WorkflowGeneratorReturnType<W[K]>
      >;
    },
  };
}

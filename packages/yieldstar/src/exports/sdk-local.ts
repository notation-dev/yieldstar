import type {
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  WorkflowInvoker,
} from "@yieldstar/core";
import { randomUUID } from "node:crypto";

export function createLocalSdk<W extends WorkflowRouter>(
  workflowRouter: W,
  invoker: WorkflowInvoker
) {
  return {
    async trigger<K extends keyof W>(
      workflowId: K,
      opts?: {
        executionId?: string;
        workflowParams?: Parameters<W[K]>[0] extends never
          ? never
          : Parameters<W[K]>[0];
      }
    ) {
      const { workflowParams } = opts ?? {};
      const executionId = opts?.executionId ?? randomUUID();
      await invoker.execute({
        executionId,
        workflowId: workflowId as string,
        params: workflowParams,
      });
      return { executionId };
    },
    async triggerAndWait<K extends keyof W>(
      workflowId: K,
      opts?: {
        executionId?: string;
        workflowParams?: Parameters<W[K]>[0] extends never
          ? never
          : Parameters<W[K]>[0];
      }
    ) {
      const { workflowParams } = opts ?? {};
      const executionId = opts?.executionId ?? randomUUID();
      const workflowCompletePromise = new Promise((resolve) => {
        invoker.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger(workflowId, { executionId, workflowParams });
      return workflowCompletePromise as Promise<
        WorkflowGeneratorReturnType<W[K]>
      >;
    },
  };
}

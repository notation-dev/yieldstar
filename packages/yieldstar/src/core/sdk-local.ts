import type {
  WorkflowRouter,
  CompositeStepGeneratorReturnType,
  WorkflowManager,
} from "../types";
import { randomUUID } from "node:crypto";

export function createLocalSdk<W extends WorkflowRouter>(
  workflowRouter: W,
  manager: WorkflowManager
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
      await manager.execute({
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
        manager.workflowEndEmitter.once(executionId, resolve);
      });
      await this.trigger(workflowId, { executionId, workflowParams });
      return workflowCompletePromise as Promise<
        CompositeStepGeneratorReturnType<W[K]>
      >;
    },
  };
}

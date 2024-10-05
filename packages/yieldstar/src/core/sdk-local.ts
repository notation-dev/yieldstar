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
      workflowParams?: Parameters<W[K]>[0] extends never
        ? never
        : Parameters<W[K]>[0]
    ) {
      const executionId = randomUUID();
      await manager.execute({
        executionId,
        workflowId: workflowId as string,
        params: workflowParams,
      });
      return { executionId };
    },
    async triggerAndWait<K extends keyof W>(
      workflowId: K,
      workflowParams?: Parameters<W[K]>[0]
    ): Promise<CompositeStepGeneratorReturnType<W[K]>> {
      const { executionId } = await this.trigger(workflowId, workflowParams);
      return new Promise((resolve) => {
        manager.taskProcessedEmitter.once(executionId, resolve);
      });
    },
  };
}
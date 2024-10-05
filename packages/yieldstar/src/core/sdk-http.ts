import type {
  WorkflowRouter,
  CompositeStepGeneratorReturnType,
} from "../types";

export function createHttpSdkFactory<W extends WorkflowRouter>(
  workflowRouter: W
) {
  return (params: { host: string; port: number }) => {
    return {
      async trigger<K extends keyof W>(
        workflowId: K,
        workflowParams?: Parameters<W[K]>[0] extends never
          ? never
          : Parameters<W[K]>[0]
      ) {
        const res = await fetch(`${params.host}:${params.port}/trigger`, {
          method: "POST",
          body: JSON.stringify({
            workflowId,
            params: workflowParams,
          }),
        });
        if (res.ok) {
          return res.json() as Promise<{ executionId: string }>;
        } else {
          throw res.statusText;
        }
      },
      async triggerAndWait<K extends keyof W>(
        workflowId: K,
        workflowParams?: Parameters<W[K]>[0]
      ) {
        const { executionId } = await this.trigger(workflowId, workflowParams);
        // todo: add timeout and cancel request
        const result = await fetch(`${params.host}:${params.port}/events`, {
          method: "POST",
          body: JSON.stringify({ executionId }),
        });
        if (result.ok) {
          return result.json() as Promise<
            CompositeStepGeneratorReturnType<W[K]>
          >;
        } else {
          throw result.statusText;
        }
      },
    };
  };
}

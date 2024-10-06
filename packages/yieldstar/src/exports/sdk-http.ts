import type {
  WorkflowRouter,
  WorkflowGeneratorReturnType,
} from "@yieldstar/core";
import { deserializeError, isErrorLike } from "serialize-error";
import { randomUUID } from "node:crypto";

export function createHttpSdkFactory<W extends WorkflowRouter>(
  workflowRouter: W
) {
  return (params: { host: string; port: number }) => {
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
        const res = await fetch(`${params.host}:${params.port}/trigger`, {
          method: "POST",
          body: JSON.stringify({
            executionId,
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
        opts?: {
          executionId?: string;
          workflowParams?: Parameters<W[K]>[0] extends never
            ? never
            : Parameters<W[K]>[0];
        }
      ) {
        const { workflowParams } = opts ?? {};
        const executionId = opts?.executionId ?? randomUUID();
        // todo: add timeout and cancel request
        await this.trigger(workflowId, { executionId, workflowParams });
        // todo: set up subscription first (maybe just use ws)
        const result = await fetch(`${params.host}:${params.port}/events`, {
          method: "POST",
          body: JSON.stringify({ executionId }),
        });

        const json = await result.json();

        if (isErrorLike(json)) {
          throw deserializeError(json);
        }

        return json as Promise<WorkflowGeneratorReturnType<W[K]>>;
      },
    };
  };
}

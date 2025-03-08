import type {
  ParamsOfWorkflow,
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  TriggerEvent,
} from "@yieldstar/core";
import { deserializeError, isErrorLike } from "serialize-error";
import { randomUUID } from "node:crypto";
import { errorWithOriginalStack } from "../internal/serialise";

export function createHttpSdkFactory<W extends WorkflowRouter>() {
  return (opts: { host: string; port: number }) => {
    return {
      async trigger<K extends keyof W>(
        workflowId: K,
        event?: TriggerEvent<ParamsOfWorkflow<W[K]>>
      ) {
        const { params } = event ?? {};
        const executionId = event?.executionId ?? randomUUID();
        const res = await fetch(`${opts.host}:${opts.port}/trigger`, {
          method: "POST",
          body: JSON.stringify({
            executionId,
            workflowId,
            params: params,
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
        event?: TriggerEvent<ParamsOfWorkflow<W[K]>>
      ) {
        const { params } = event ?? {};
        const executionId = event?.executionId ?? randomUUID();
        // todo: add timeout and cancel request
        await this.trigger(workflowId, { executionId, params });
        // todo: set up subscription first (maybe just use ws)
        const result = await fetch(`${opts.host}:${opts.port}/events`, {
          method: "POST",
          body: JSON.stringify({ executionId }),
        });

        const json = await result.json();

        if (isErrorLike(json)) {
          throw errorWithOriginalStack(
            deserializeError(json),
            this.triggerAndWait
          );
        }

        return json as Promise<WorkflowGeneratorReturnType<W[K]>>;
      },
    };
  };
}

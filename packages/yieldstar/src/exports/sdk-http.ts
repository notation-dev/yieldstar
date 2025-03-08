import type {
  EventParamsOfWorkflow,
  WorkflowRouter,
  WorkflowGeneratorReturnType,
  TriggerEvent,
  ExecutionEvent,
} from "@yieldstar/core";
import { deserializeError, isErrorLike } from "serialize-error";
import { randomUUID } from "node:crypto";
import { errorWithOriginalStack } from "../internal/serialise";

export function createHttpSdkFactory<W extends WorkflowRouter>() {
  return (params: { host: string; port: number }) => {
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

        const res = await fetch(`${params.host}:${params.port}/trigger`, {
          method: "POST",
          body: JSON.stringify(executionEvent),
        });

        if (res.ok) {
          return res.json() as Promise<{ executionId: string }>;
        } else {
          throw res.statusText;
        }
      },
      async triggerAndWait<K extends keyof W>(
        workflowId: K,
        triggerEvent?: TriggerEvent<EventParamsOfWorkflow<W[K]>>
      ) {
        // todo: add timeout and cancel request
        const { executionId } = await this.trigger(workflowId, triggerEvent);

        // todo: set up subscription first (maybe just use ws)
        const result = await fetch(`${params.host}:${params.port}/events`, {
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

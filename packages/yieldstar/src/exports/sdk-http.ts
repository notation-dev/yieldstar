import type {
  EventParamsOf,
  WorkflowRouter,
  TriggerEvent,
  ExecutionEvent,
} from "@yieldstar/core";
import { nanoid } from "nanoid";
import { deserializeError, isErrorLike } from "serialize-error";
import { errorWithOriginalStack } from "../internal/serialise";
import type { TriggerAck, WorkflowResult } from "../internal/types";

export function createHttpSdkFactory<W extends WorkflowRouter>() {
  return (params: { host: string; port: number }) => {
    return {
      async trigger<K extends string & keyof W>(
        event: TriggerEvent<K, EventParamsOf<W[K]>>
      ): TriggerAck {
        const executionEvent: ExecutionEvent = {
          executionId: event?.executionId ?? nanoid(),
          workflowId: event?.workflowId as string,
          params: event?.params,
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
      async triggerAndWait<K extends string & keyof W>(
        event: TriggerEvent<K, EventParamsOf<W[K]>>
      ): WorkflowResult<W, K> {
        // todo: add timeout and cancel request
        const { executionId } = await this.trigger(event);

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

        return json as WorkflowResult<W, K>;
      },
    };
  };
}

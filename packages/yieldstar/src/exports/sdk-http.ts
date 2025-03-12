import type {
  EventParamsOf,
  WorkflowRouter,
  TriggerEvent,
  ExecutionEvent,
  WorkflowGeneratorReturnType,
} from "@yieldstar/core";
import { nanoid } from "nanoid";
import { deserializeError } from "serialize-error";
import { errorWithOriginalStack } from "../internal/serialise";

type TriggerAck = {
  executionId: string;
};

type TriggerResponse<W extends WorkflowRouter, K extends string & keyof W> = {
  executionId: string;
  ack: () => Promise<TriggerAck>;
  waitForResult: () => Promise<WorkflowGeneratorReturnType<W[K]>>;
};

export function createHttpSdkFactory<W extends WorkflowRouter>() {
  return (params: { host: string; port: number }) => {
    return {
      async trigger<K extends string & keyof W>(
        event: TriggerEvent<K, EventParamsOf<W[K]>>
      ): Promise<TriggerResponse<W, K>> {
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
          return {
            executionId: executionEvent.executionId,
            ack: () => res.json() as Promise<TriggerAck>,
            waitForResult: () =>
              this.waitForResult<K>({
                executionId: executionEvent.executionId,
              }),
          };
        } else {
          throw res.statusText;
        }
      },
      async waitForResult<K extends string & keyof W>(
        ack: TriggerAck
      ): Promise<WorkflowGeneratorReturnType<W[K]>> {
        // todo: set up subscription first (maybe just use ws)
        const res = await fetch(`${params.host}:${params.port}/events`, {
          method: "POST",
          body: JSON.stringify({ executionId: ack.executionId }),
        });

        if (res.status === 500) {
          const error = await res.json();
          throw errorWithOriginalStack(
            deserializeError(error),
            this.waitForResult
          );
        }

        return res.json() as Promise<WorkflowGeneratorReturnType<W[K]>>;
      },
    };
  };
}

import type { Logger } from "pino";
import { HeapClient } from "./heap";
import { StepResponse, WorkflowResult } from "./step";
import type { ExecutionEvent, WorkflowEvent } from "./event";

export type WorkflowGeneratorParams<
  EventParams,
  Context extends Map<any, any>
> = {
  event: WorkflowEvent<EventParams, Context>;
  heapClient: HeapClient;
  logger: Logger;
};

export type WorkflowGenerator<
  EventParams,
  Result,
  Context extends Map<any, any>
> = (
  genParams: WorkflowGeneratorParams<EventParams, Context>
) => AsyncGenerator<StepResponse, WorkflowResult<Result>, StepResponse>;

export type WorkflowGeneratorReturnType<CG> = CG extends WorkflowGenerator<
  infer EventParams,
  infer Result,
  infer Context
>
  ? Result
  : never;

export type WorkflowRouter = Record<string, WorkflowGenerator<any, any, any>>;

export type EventOfWorkflow<W extends WorkflowGenerator<any, any, any>> =
  Parameters<W>[0]["event"];

export type EventParamsOf<W extends WorkflowGenerator<any, any, any>> =
  Parameters<W>[0]["event"]["params"];

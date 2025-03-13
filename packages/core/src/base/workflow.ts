import type { Logger } from "pino";
import type { EventParams, WorkflowEvent, EventContext } from "./event";
import { HeapClient } from "./heap";
import { StepResponse, WorkflowResult } from "./step";

export type WorkflowGeneratorParams<
  Params extends EventParams,
  Context extends EventContext
> = {
  event: WorkflowEvent<Params, Context>;
  heapClient: HeapClient;
  logger: Logger;
};

export type WorkflowGenerator<
  Params extends EventParams,
  Result,
  Context extends EventContext
> = (
  genParams: WorkflowGeneratorParams<Params, Context>
) => AsyncGenerator<StepResponse, WorkflowResult<Result>, StepResponse>;

export type WorkflowGeneratorReturnType<CG> = CG extends WorkflowGenerator<
  infer Params,
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

import type { Logger } from "pino";
import { HeapClient } from "./heap";
import { StepResponse, WorkflowResult } from "./step";
import type { ExecutionEvent } from "./event";

export type WorkflowGeneratorParams<EventParams> = {
  event: ExecutionEvent<EventParams>;
  heapClient: HeapClient;
  logger: Logger;
};

export type WorkflowGenerator<EventParams, Result> = (
  genParams: WorkflowGeneratorParams<EventParams>
) => AsyncGenerator<StepResponse, WorkflowResult<Result>, StepResponse>;

export type WorkflowGeneratorReturnType<CG> = CG extends WorkflowGenerator<
  infer EventParams,
  infer Result
>
  ? Result
  : never;

export type WorkflowRouter = Record<string, WorkflowGenerator<any, any>>;

export type EventOfWorkflow<W extends WorkflowGenerator<any, any>> =
  Parameters<W>[0]["event"];

export type ParamsOfWorkflow<W extends WorkflowGenerator<any, any>> =
  Parameters<W>[0]["event"]["params"];

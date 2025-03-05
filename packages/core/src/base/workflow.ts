import type { Logger } from "pino";
import { HeapClient } from "./heap";
import { StepResponse, WorkflowResult } from "./step";

export type WorkflowGenerator<T = any> = (params: {
  executionId: string;
  heapClient: HeapClient;
  logger: Logger;
}) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

export type WorkflowGeneratorReturnType<CG> = CG extends WorkflowGenerator<
  infer T
>
  ? T
  : never;

export type WorkflowRouter = Record<string, WorkflowGenerator>;

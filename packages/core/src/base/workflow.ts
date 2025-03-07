import type { Logger } from "pino";
import { HeapClient } from "./heap";
import { StepResponse, WorkflowResult } from "./step";

export type WorkflowGeneratorParams = {
  /**
   * The ID of the workflow being executed.
   */
  workflowId: string;

  /**
   * The unique execution ID for this workflow run.
   */
  executionId: string;

  /**
   * The heap client for storing and retrieving workflow state.
   */
  heapClient: HeapClient;

  /**
   * Logger instance for the workflow.
   */
  logger: Logger;

  /**
   * Optional parameters passed to the workflow.
   */
  params?: any;
};

export type WorkflowGenerator<T = any> = (
  params: WorkflowGeneratorParams
) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

export type WorkflowGeneratorReturnType<CG> = CG extends WorkflowGenerator<
  infer T
>
  ? T
  : never;

export type WorkflowRouter = Record<string, WorkflowGenerator>;

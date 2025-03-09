import type { WorkflowGeneratorReturnType } from "@yieldstar/core";

export type TriggerAck = Promise<{
  executionId: string;
}>;

export type WorkflowResult<W, K extends keyof W> = Promise<
  WorkflowGeneratorReturnType<W[K]>
>;

import type { WorkflowResult } from "./step-response";

export type Task = { workflowId: string; executionId: string; params?: any };

export type TaskProcessor = <T = any>(
  task: Task
) => Promise<void | WorkflowResult<T>>;

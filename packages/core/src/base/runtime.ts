import type { Logger } from "pino";
import type { WorkflowResult } from "./step";

export type Task = { workflowId: string; executionId: string; params?: any };

export type TaskProcessor = <T = any>(
  task: Task,
  logger: Logger
) => Promise<void | WorkflowResult<T>>;

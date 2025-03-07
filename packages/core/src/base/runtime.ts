import type { Logger } from "pino";
import type { WorkflowResult } from "./step";
import type { ExecutionEvent } from "./event";

export type TaskProcessor = <T = any>(
  task: ExecutionEvent,
  logger: Logger
) => Promise<void | WorkflowResult<T>>;

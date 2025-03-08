import type { Logger } from "pino";
import type { WorkflowResult } from "./step";
import type { ExecutionEvent } from "./event";

export type EventProcessor<EventParams = any, Result = any> = (
  event: ExecutionEvent<EventParams>,
  logger: Logger
) => Promise<void | WorkflowResult<Result>>;

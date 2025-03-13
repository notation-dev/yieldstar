import type { Logger } from "pino";
import type { WorkflowResult } from "./step";
import type { WorkflowEvent } from "./event";

export type EventProcessor<
  EventParams = any,
  Result = any,
  Context extends ReadonlyMap<any, any> = ReadonlyMap<any, any>
> = (
  event: WorkflowEvent<EventParams, Context>,
  logger: Logger
) => Promise<void | WorkflowResult<Result>>;

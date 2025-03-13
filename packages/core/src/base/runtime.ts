import type { Logger } from "pino";
import type { WorkflowResult } from "./step";
import type { WorkflowEvent } from "./event";

export type EventProcessor = (
  event: WorkflowEvent,
  logger: Logger
) => Promise<void | WorkflowResult<any>>;

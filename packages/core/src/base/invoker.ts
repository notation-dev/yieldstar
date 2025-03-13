import type { EventEmitter } from "node:events";
import type { ExecutionEvent } from "./event";

export type WorkflowInvoker = {
  workflowEndEmitter: EventEmitter;
  execute(event: ExecutionEvent): Promise<void>;
};

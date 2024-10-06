import type { EventEmitter } from "node:events";
import type { Task } from "./runtime";

export type WorkflowInvoker = {
  workflowEndEmitter: EventEmitter;
  execute(message: Task): Promise<void>;
};

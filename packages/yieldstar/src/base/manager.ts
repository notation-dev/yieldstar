import type { EventEmitter } from "node:events";
import type { Task } from "./runtime";

export type WorkflowManager = {
  taskProcessedEmitter: EventEmitter;
  execute(message: Task): Promise<void>;
};

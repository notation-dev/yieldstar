import type { Logger } from "pino";
import type { Task, WorkflowManager } from "yieldstar";
import { EventEmitter } from "node:events";

export function createWorkflowManager(params: {
  workerPath: string;
  logger: Logger;
}): WorkflowManager {
  const workflowEndEmitter = new EventEmitter();
  const { logger, workerPath } = params;
  return {
    workflowEndEmitter,
    async execute(task: Task) {
      const { executionId } = task;
      logger.info({ executionId }, "Starting worker");
      const worker = new Worker(workerPath);
      worker.postMessage(task);
      worker.onmessage = (event) => {
        switch (event.data.status) {
          case "completed":
            const response = event.data.response;
            if (response) {
              workflowEndEmitter.emit(executionId, response.result);
            }
            break;
          case "error":
            // todo: this is much less readable than console.error
            logger.error(event.data.error);
            workflowEndEmitter.emit(executionId, event.data.error);
        }
        logger.info({ executionId }, "Terminating worker");
        worker.terminate();
      };
    },
  };
}

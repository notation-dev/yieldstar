import type { Logger } from "pino";
import type { Task, WorkflowManager } from "yieldstar";
import { EventEmitter } from "node:events";

export function createWorkflowManager(params: {
  workerPath: string;
  logger: Logger;
}): WorkflowManager {
  const taskProcessedEmitter = new EventEmitter();
  const { logger, workerPath } = params;
  return {
    taskProcessedEmitter,
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
              taskProcessedEmitter.emit(executionId, response.result);
            }
            break;
          case "error":
            // todo: this is much less readable than console.error
            logger.error(event.data.error);
            taskProcessedEmitter.emit(executionId, event.data.error);
        }
        logger.info({ executionId }, "Terminating worker");
        worker.terminate();
      };
    },
  };
}

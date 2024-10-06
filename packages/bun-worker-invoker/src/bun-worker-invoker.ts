import type { Logger } from "pino";
import type { Task, WorkflowInvoker } from "@yieldstar/core";
import { EventEmitter } from "node:events";

export function createWorkflowInvoker(params: {
  workerPath: string;
  logger: Logger;
}): WorkflowInvoker {
  const workflowEndEmitter = new EventEmitter();
  const { logger, workerPath } = params;
  return {
    workflowEndEmitter,
    async execute(task: Task) {
      const { executionId } = task;
      const worker = new Worker(workerPath);

      logger.info({ executionId }, "Starting worker");

      worker.onerror = (event) => {
        logger.error(event.message);
      };

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

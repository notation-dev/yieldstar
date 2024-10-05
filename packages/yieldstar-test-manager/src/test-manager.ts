import type { Logger } from "pino";
import type { Task, WorkflowManager, WorkflowRunner } from "yieldstar";
import { EventEmitter } from "node:events";

export function createWorkflowManager(params: {
  logger: Logger;
  runner: WorkflowRunner<any>;
}): WorkflowManager {
  const taskProcessedEmitter = new EventEmitter();
  const { logger, runner } = params;
  return {
    taskProcessedEmitter,
    async execute(task: Task) {
      const { executionId } = task;
      logger.info({ executionId }, "Starting workflow exeuction");
      try {
        const response = await runner.run(task);
        if (response) {
          taskProcessedEmitter.emit(executionId, response.result);
        }
      } catch (err) {
        logger.error(err);
        taskProcessedEmitter.emit(executionId, err);
      }
    },
  };
}

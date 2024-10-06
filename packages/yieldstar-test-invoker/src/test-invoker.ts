import type { Logger } from "pino";
import type { Task, WorkflowInvoker, WorkflowRunner } from "yieldstar";
import { EventEmitter } from "node:events";

export function createWorkflowInvoker(params: {
  logger: Logger;
  runner: WorkflowRunner<any>;
}): WorkflowInvoker {
  const workflowEndEmitter = new EventEmitter();
  const { logger, runner } = params;
  return {
    workflowEndEmitter,
    async execute(task: Task) {
      const { executionId } = task;
      logger.info({ executionId }, "Starting workflow exeuction");
      try {
        const response = await runner.run(task);
        if (response) {
          workflowEndEmitter.emit(executionId, response.result);
        }
      } catch (err) {
        logger.error(err);
        workflowEndEmitter.emit(executionId, err);
      }
    },
  };
}

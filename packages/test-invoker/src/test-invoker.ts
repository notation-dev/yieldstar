import type { Logger } from "pino";
import type {
  WorkflowEvent,
  WorkflowInvoker,
  WorkflowRunner,
} from "@yieldstar/core";
import { EventEmitter } from "node:events";

export function createWorkflowInvoker(params: {
  logger: Logger;
  runner: WorkflowRunner<any>;
}): WorkflowInvoker {
  const workflowEndEmitter = new EventEmitter();
  const { logger, runner } = params;
  return {
    workflowEndEmitter,
    async execute(event: WorkflowEvent) {
      const { executionId } = event;
      logger.info({ executionId }, "Starting workflow execution");
      try {
        const response = await runner.run(event, logger);
        if (response) {
          workflowEndEmitter.emit(executionId, response.result);
        }
      } catch (err: any) {
        logger.error(err);
        workflowEndEmitter.emit(executionId, err);
      }
    },
  };
}

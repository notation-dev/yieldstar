import type { Logger } from "pino";
import type { Task, WorkflowInvoker } from "@yieldstar/core";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { deserializeError } from "serialize-error";

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

      const filePath = workerPath.startsWith("file:")
        ? fileURLToPath(workerPath)
        : workerPath;

      const childProcess = Bun.spawn(["bun", filePath], {
        ipc(message, childProcess) {
          switch (message.status) {
            case "completed":
              const response = message.response;
              if (response) {
                workflowEndEmitter.emit(executionId, response.result);
              }
              break;
            case "error":
              workflowEndEmitter.emit(
                executionId,
                deserializeError(message.error)
              );
              logger.error({ executionId }, message.error);
          }

          logger.info({ executionId }, "Terminating child process");
          childProcess.kill();
        },
        stdout: "inherit",
        stderr: "inherit",
      });

      logger.info({ executionId }, "Starting child process");

      childProcess.send(task);
    },
  };
}

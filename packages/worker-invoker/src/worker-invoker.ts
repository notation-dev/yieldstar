import type { Logger } from "pino";
import type { MiddlewareEvent, WorkflowInvoker } from "@yieldstar/core";
import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deserializeError } from "serialize-error";

export function createWorkflowInvoker(params: {
  workerPath: string;
  execPath?: string;
  logger: Logger;
}): WorkflowInvoker {
  const workflowEndEmitter = new EventEmitter();
  const { logger, workerPath, execPath } = params;
  return {
    workflowEndEmitter,
    async execute(event: MiddlewareEvent) {
      const { executionId } = event;

      const filePath = workerPath.startsWith("file:")
        ? fileURLToPath(workerPath)
        : workerPath;

      const childProcess = fork(filePath, [], {
        execPath,
        serialization: "advanced",
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      });
      let spawned = false;
      let settled = false;

      const emitWorkflowError = (error: Error) => {
        if (settled) return;
        settled = true;
        workflowEndEmitter.emit(executionId, error);
        logger.error({ executionId, err: error }, error.message);
      };

      const spawn = new Promise<void>((resolve, reject) => {
        childProcess.once("spawn", () => {
          spawned = true;
          resolve();
        });
        childProcess.on("error", (error) => {
          if (!spawned) {
            settled = true;
            reject(error);
            return;
          }
          emitWorkflowError(error);
        });
      });

      childProcess.on("exit", (code, signal) => {
        if (settled) return;
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        emitWorkflowError(
          new Error(`Worker process exited before replying (${detail})`)
        );
      });

      childProcess.on("message", (message: any) => {
        if (settled) return;
        // A reply settles the child's outcome even when there is nothing to
        // emit (a suspended workflow resumes later in a fresh child), so the
        // exit handler must not report the deliberate kill below as an error.
        settled = true;
        switch (message.status) {
          case "completed":
            const response = message.response;
            if (response) {
              workflowEndEmitter.emit(executionId, response.result);
            }
            break;
          case "error":
            const error = deserializeError(message.error);
            workflowEndEmitter.emit(executionId, error);
            logger.error({ executionId, err: error }, "Workflow errored");
        }

        logger.info({ executionId }, "Terminating child process");
        childProcess.kill();
      });

      logger.info({ executionId }, "Starting child process");
      await spawn;

      childProcess.send(event, (error) => {
        if (error) {
          emitWorkflowError(error);
          childProcess.kill();
        }
      });
    },
  };
}

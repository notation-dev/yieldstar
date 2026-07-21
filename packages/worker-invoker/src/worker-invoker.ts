import type { Logger } from "pino";
import type { MiddlewareEvent, WorkflowInvoker } from "@yieldstar/core";
import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deserializeError } from "serialize-error";

export function createWorkflowInvoker(params: {
  workerPath: string;
  execPath?: string;
  handshakeTimeout?: number;
  logger: Logger;
}): WorkflowInvoker {
  const workflowEndEmitter = new EventEmitter();
  const { logger, workerPath, execPath, handshakeTimeout = 5_000 } = params;
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
        clearTimeout(handshakeTimer);
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
            clearTimeout(handshakeTimer);
            settled = true;
            reject(error);
            return;
          }
          emitWorkflowError(error);
        });
      });

      // The worker sends a "ready" message once it is listening. Until it
      // arrives we hold the event back: a worker running a different runtime
      // (or an incompatible IPC serialization) can never decode our frames,
      // so a missing handshake turns a silent hang into a clear error.
      let ready = false;
      const handshakeTimer = setTimeout(() => {
        emitWorkflowError(
          new Error(
            `Worker did not complete the IPC handshake within ${handshakeTimeout}ms. ` +
              "Check that the worker calls listen() and that execPath runs the same runtime as the parent process."
          )
        );
        childProcess.kill();
      }, handshakeTimeout);

      childProcess.on("exit", (code, signal) => {
        clearTimeout(handshakeTimer);
        if (settled) return;
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        emitWorkflowError(
          new Error(`Worker process exited before replying (${detail})`)
        );
      });

      childProcess.on("message", (message: any) => {
        if (settled) return;
        if (message.status === "ready") {
          if (ready) return;
          ready = true;
          clearTimeout(handshakeTimer);
          childProcess.send(event, (error) => {
            if (error) {
              emitWorkflowError(error);
              childProcess.kill();
            }
          });
          return;
        }
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
    },
  };
}

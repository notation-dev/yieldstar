import type { Logger } from "pino";
import type { ExecutionEvent, WorkflowRunner } from "@yieldstar/core";
import { serializeError } from "serialize-error";

export function createWorkflowWorker(
  workflowRunner: WorkflowRunner<any>,
  logger: Logger
) {
  return {
    listen() {
      process.on("message", async (task: ExecutionEvent) => {
        try {
          const response = await workflowRunner.run(task, logger);
          process.send!({ status: "completed", response });
        } catch (error: any) {
          process.send!({ status: "error", error: serializeError(error) });
        }
      });
    },
  };
}

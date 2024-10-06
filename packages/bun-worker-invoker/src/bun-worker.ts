import type { Logger } from "pino";
import type { Task, WorkflowRunner } from "@yieldstar/core";

declare var self: Worker;

export function createWorkflowWorker(
  workflowRunner: WorkflowRunner<any>,
  logger: Logger
) {
  return {
    listen() {
      self.onmessage = async (event: { data: Task }) => {
        const task = event.data;
        try {
          // todo: pass logger in here
          const response = await workflowRunner.run(task);
          self.postMessage({ status: "completed", response });
        } catch (error: any) {
          self.postMessage({ status: "error", error });
        }
      };
    },
  };
}

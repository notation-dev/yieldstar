import type { Logger } from "pino";
import type { Task, WorkflowRouter } from "yieldstar";
import { WorkflowRunner } from "yieldstar";

declare var self: Worker;

export function createWorkflowWorker<T extends WorkflowRouter>(
  workflowRunner: WorkflowRunner<T>,
  logger: Logger
) {
  return {
    listen() {
      self.onmessage = async (event: { data: Task }) => {
        const task = event.data;
        try {
          // todo: pass logger in here
          const result = await workflowRunner.run(task);
          self.postMessage({ status: "completed", result });
        } catch (error: any) {
          self.postMessage({ status: "error", error });
        }
      };
    },
  };
}

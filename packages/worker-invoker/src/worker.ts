import type { Logger } from "pino";
import type {
  EventContext,
  MiddlewareEvent,
  WorkflowEvent,
  WorkflowRunner,
} from "@yieldstar/core";
import { ReadOnlyMap } from "@yieldstar/core";
import { serializeError } from "serialize-error";

let context: EventContext;

export const getContext = () => context;

export function createWorkflowWorker(
  workflowRunner: WorkflowRunner<any>,
  logger: Logger
) {
  return {
    listen() {
      process.on("message", async (event: MiddlewareEvent) => {
        const workflowEvent: WorkflowEvent = {
          ...event,
          context: new ReadOnlyMap(event.context),
        };
        context = workflowEvent.context;
        try {
          const response = await workflowRunner.run(workflowEvent, logger);
          process.send!({ status: "completed", response });
        } catch (error: any) {
          process.send!({ status: "error", error: serializeError(error) });
        }
      });
      process.send!({ status: "ready" });
    },
  };
}

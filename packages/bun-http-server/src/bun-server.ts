import type { Logger } from "pino";
import type { ExecutionEvent, WorkflowInvoker } from "@yieldstar/core";
import { serializeError } from "serialize-error";

export function createWorkflowHttpServer(params: {
  port: number;
  invoker: WorkflowInvoker;
  logger: Logger;
}) {
  const { logger, port, invoker } = params;
  return {
    serve() {
      return Bun.serve({
        port: port,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/events") {
            const { executionId } = (await req.json()) as {
              executionId: string;
            };

            if (!executionId) {
              return new Response("Missing executionId", { status: 400 });
            }

            const result = await new Promise((resolve) => {
              invoker.workflowEndEmitter.once(executionId, resolve);
            });

            if (result instanceof Error) {
              return Response.json(serializeError(result));
            }

            return Response.json(result);
          }

          if (url.pathname === "/trigger") {
            try {
              const event = (await req.json()) as ExecutionEvent;
              await invoker.execute(event);
              return Response.json(
                { executionId: event.executionId },
                { status: 202 }
              );
            } catch (err: any) {
              logger.error(err);
              return Response.json(err.message, { status: 400 });
            }
          }

          return new Response("Not Found", { status: 404 });
        },
      });
    },
  };
}

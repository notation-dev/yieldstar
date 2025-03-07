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
        websocket: {
          message() {},
          open() {},
          close() {},
        },
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/events") {
            const { executionId } = (await req.json()) as {
              executionId: string;
            };

            return new Promise((resolve) => {
              invoker.workflowEndEmitter.once(executionId, (result) => {
                resolve(
                  new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" },
                  })
                );
              });
            });
          }

          if (url.pathname === "/trigger") {
            try {
              const body = (await req.json()) as ExecutionEvent;
              await invoker.execute(body);
              return new Response(
                JSON.stringify({ executionId: body.executionId }),
                {
                  headers: { "Content-Type": "application/json" },
                }
              );
            } catch (err: any) {
              logger.error(err);
              return new Response(JSON.stringify(serializeError(err)), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              });
            }
          }

          return new Response("Not found", { status: 404 });
        },
      });
    },
  };
}

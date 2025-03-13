import type { Logger } from "pino";
import type {
  ExecutionEvent,
  WorkflowInvoker,
  WorkflowEvent,
} from "@yieldstar/core";
import { serializeError } from "serialize-error";
import {
  FreezableMap,
  ReadOnlyMap,
  MiddlewareEvent,
  MiddlewareFunction,
} from "@yieldstar/core";
import { executeMiddlewareChain } from "./middleware";

export function createWorkflowHttpServer(params: {
  port: number;
  invoker: WorkflowInvoker;
  logger: Logger;
  middleware?: MiddlewareFunction[];
}) {
  const { logger, port, invoker, middleware = [] } = params;

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
              return new Response("Missing executionId", {
                status: 400,
              });
            }

            const result = await new Promise((resolve) => {
              invoker.workflowEndEmitter.once(executionId, resolve);
            });

            if (result instanceof Error) {
              return Response.json(serializeError(result), {
                status: 500,
              });
            }

            return Response.json(result);
          }

          if (url.pathname === "/trigger") {
            const executionEvent = (await req.json()) as ExecutionEvent;

            const event: MiddlewareEvent = {
              ...executionEvent,
              context: new FreezableMap<string, any>(),
            };

            return executeMiddlewareChain(
              req,
              event,
              logger,
              middleware,
              async (req, event) => {
                try {
                  const workflowEvent: WorkflowEvent = {
                    ...event,
                    context: new ReadOnlyMap(event.context),
                  };
                  await invoker.execute(workflowEvent);
                  return Response.json(
                    { executionId: event.executionId },
                    { status: 202 }
                  );
                } catch (err: any) {
                  logger.error(err);
                  return Response.json(err.message, { status: 400 });
                }
              }
            );
          }

          return new Response("Not Found", { status: 404 });
        },
      });
    },
  };
}

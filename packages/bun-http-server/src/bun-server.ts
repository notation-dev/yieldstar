import type { RouterTypes } from "bun";
import type { Logger } from "pino";
import type { ExecutionEvent, WorkflowInvoker } from "@yieldstar/core";
import { serializeError } from "serialize-error";
import {
  FreezableMap,
  MiddlewareEvent,
  MiddlewareFunction,
} from "@yieldstar/core";
import { executeMiddlewareChain } from "./middleware";

export function createWorkflowRoutes<R extends `/${string}`>(params: {
  basePath?: R;
  invoker: WorkflowInvoker;
  logger: Logger;
  middleware?: MiddlewareFunction[];
}): Record<string, { POST: RouterTypes.RouteHandler<string> }> {
  const { logger, invoker, middleware = [], basePath = "" } = params;

  return {
    [`${basePath}/trigger`]: {
      POST: async (req) => {
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
        );
      },
    },
    [`${basePath}/events`]: {
      POST: async (req) => {
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

        return new Response("Not Found", { status: 404 });
      },
    },
  };
}

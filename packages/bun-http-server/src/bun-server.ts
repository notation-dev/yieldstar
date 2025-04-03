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

export const createTriggerHandler =
  (params: {
    invoker: WorkflowInvoker;
    logger: Logger;
    middleware?: MiddlewareFunction[];
  }): RouterTypes.RouteHandler<string> =>
  async (req) => {
    const { logger, invoker, middleware = [] } = params;

    const executionEvent = (await req.json()) as ExecutionEvent;

    const event: MiddlewareEvent = {
      ...executionEvent,
      context: new FreezableMap<string, any>(
        Object.entries(executionEvent.context ?? {})
      ),
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
  };

export const createEventsHandler =
  (params: { invoker: WorkflowInvoker }): RouterTypes.RouteHandler<string> =>
  async (req) => {
    const { invoker } = params;

    const url = new URL(req.url);

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
  };

export function createRoutes(params: {
  basePath?: `/${string}`;
  invoker: WorkflowInvoker;
  logger: Logger;
  middleware?: MiddlewareFunction[];
}): Record<string, { POST: RouterTypes.RouteHandler<string> }> {
  const { logger, invoker, middleware = [], basePath = "" } = params;
  return {
    [`${basePath}/trigger`]: {
      POST: createTriggerHandler({ invoker, logger, middleware }),
    },
    [`${basePath}/events`]: {
      POST: createEventsHandler({ invoker }),
    },
  };
}

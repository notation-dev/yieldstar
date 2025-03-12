import type { Logger } from "pino";
import type { ExecutionEvent } from "@yieldstar/core";

export type MiddlewareEvent = ExecutionEvent & {
  context: Map<string, any>;
};

export type MiddlewareNext = () => Promise<Response>;

export type MiddlewareFunction = (
  req: Request,
  event: MiddlewareEvent,
  next: MiddlewareNext,
  logger: Logger
) => Promise<Response>;

/**
 * Creates a middleware function that can be used with the HTTP server.
 *
 * @param middleware The middleware function to execute
 * @returns A middleware function
 */
export function createMiddleware(
  middleware: MiddlewareFunction
): MiddlewareFunction {
  return middleware;
}

/**
 * Executes a chain of middleware functions.
 *
 * @param req The request object
 * @param event The middleware event with context
 * @param middlewares The array of middleware functions to execute
 * @param handler The final handler function to execute
 * @returns A response
 */
export async function executeMiddlewareChain(
  req: Request,
  event: MiddlewareEvent,
  logger: Logger,
  middlewares: MiddlewareFunction[],
  handler: (req: Request, event: MiddlewareEvent) => Promise<Response>
): Promise<Response> {
  if (!middlewares.length) {
    return handler(req, event);
  }

  let index = 0;

  const next = async (): Promise<Response> => {
    if (index >= middlewares.length) {
      return await handler(req, event);
    }

    const middleware = middlewares[index++];
    return middleware(req, event, next, logger);
  };

  return next();
}

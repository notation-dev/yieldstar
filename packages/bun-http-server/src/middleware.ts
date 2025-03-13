import type { Logger } from "pino";
import type { MiddlewareEvent, MiddlewareFunction } from "@yieldstar/core";

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
    event.context.freeze();
    return handler(req, event);
  }

  let index = 0;

  const next = async (): Promise<Response> => {
    if (index >= middlewares.length) {
      event.context.freeze();
      return await handler(req, event);
    }

    const middleware = middlewares[index++];
    return middleware(req, event, next, logger);
  };

  return next();
}

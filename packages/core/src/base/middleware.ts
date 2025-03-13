import type { Logger } from "pino";
import type { MiddlewareEvent } from "./event";

export type MiddlewareNext = () => Promise<Response>;

export type MiddlewareFunction = (
  req: Request,
  event: MiddlewareEvent,
  next: MiddlewareNext,
  logger: Logger
) => Promise<Response>;

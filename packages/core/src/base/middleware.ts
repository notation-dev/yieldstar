import type { Logger } from "pino";
import { ExecutionEvent } from "./event";
import { FreezableMap } from "../utils/map";

export type MiddlewareEvent = ExecutionEvent & {
  context: FreezableMap<string, any>;
};

export type MiddlewareNext = () => Promise<Response>;

export type MiddlewareFunction = (
  req: Request,
  event: MiddlewareEvent,
  next: MiddlewareNext,
  logger: Logger
) => Promise<Response>;

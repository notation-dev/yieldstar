import { beforeEach, expect, it, mock } from "bun:test";
import pino from "pino";
import {
  createMiddleware,
  executeMiddlewareChain,
  MiddlewareEvent,
} from "./middleware";

const logger = pino();

const reqFixture = new Request("http://localhost");
const handlerMock = mock(async () => new Response("OK"));

const eventFixture: MiddlewareEvent = {
  context: new Map(),
  workflowId: "test",
  executionId: "test",
  params: {},
};

beforeEach(() => {
  handlerMock.mockClear();
  eventFixture.context = new Map();
});

it("should create a middleware function", () => {
  const middleware = createMiddleware(async (req, event, next) => {
    return next();
  });

  expect(typeof middleware).toBe("function");
});

it("should execute middleware chain with no middleware", async () => {
  const response = await executeMiddlewareChain(
    reqFixture,
    eventFixture,
    logger,
    [],
    handlerMock
  );

  expect(handlerMock).toHaveBeenCalledTimes(1);
  expect(await response.text()).toBe("OK");
});

it("should execute middleware chain with one middleware", async () => {
  const middleware = createMiddleware(async (req, event, next) => {
    event.context.set("test", "value");
    return next();
  });

  const response = await executeMiddlewareChain(
    reqFixture,
    eventFixture,
    logger,
    [middleware],
    handlerMock
  );

  expect(handlerMock).toHaveBeenCalledTimes(1);
  expect(eventFixture.context.get("test")).toBe("value");
  expect(await response.text()).toBe("OK");
});

it("should execute middleware chain with multiple middleware", async () => {
  const middleware1 = createMiddleware(async (req, event, next) => {
    event.context.set("test1", "value1");
    return next();
  });

  const middleware2 = createMiddleware(async (req, event, next) => {
    event.context.set("test2", "value2");
    return next();
  });

  const response = await executeMiddlewareChain(
    reqFixture,
    eventFixture,
    logger,
    [middleware1, middleware2],
    handlerMock
  );

  expect(handlerMock).toHaveBeenCalledTimes(1);
  expect(eventFixture.context.get("test1")).toBe("value1");
  expect(eventFixture.context.get("test2")).toBe("value2");
  expect(await response.text()).toBe("OK");
});

it("should short-circuit middleware chain if middleware returns a response", async () => {
  const middleware1 = createMiddleware(async (req, event, next) => {
    event.context.set("test1", "value1");
    return new Response("Unauthorized", { status: 401 });
  });

  const middleware2 = createMiddleware(async (req, event, next) => {
    event.context.set("test2", "value2");
    return next();
  });

  const response = await executeMiddlewareChain(
    reqFixture,
    eventFixture,
    logger,
    [middleware1, middleware2],
    handlerMock
  );

  expect(handlerMock).not.toHaveBeenCalled();
  expect(eventFixture.context.get("test1")).toBe("value1");
  expect(eventFixture.context.get("test2")).toBeUndefined();
  expect(await response.text()).toBe("Unauthorized");
  expect(response.status).toBe(401);
});

it("should allow middleware to modify the response", async () => {
  const middleware = createMiddleware(async (req, event, next) => {
    const response = await next();
    response.headers.set("X-Test", "test-value");
    return response;
  });

  const response = await executeMiddlewareChain(
    reqFixture,
    eventFixture,
    logger,
    [middleware],
    handlerMock
  );

  expect(handlerMock).toHaveBeenCalledTimes(1);
  expect(response.headers.get("X-Test")).toBe("test-value");
});

# @yieldstar/http-server

HTTP routes and middleware for triggering workflows over the network. Handlers use the standard `Request` and `Response` APIs.

## Install

```sh
bun add @yieldstar/http-server
```

## `createRoutes({ invoker, logger, middleware?, basePath? })`

Returns route handlers for `POST /trigger` and `POST /events`. The routes object plugs directly into `Bun.serve({ routes })` or any router that accepts `Request` to `Response` handlers.

```ts
import { createRoutes } from "@yieldstar/http-server";

Bun.serve({
  port: 8080,
  routes: {
    ...createRoutes({ invoker, logger }),
  },
});
```

| Param        | Type                   | Description                      |
| ------------ | ---------------------- | -------------------------------- |
| `invoker`    | `WorkflowInvoker`      | The invoker to execute workflows |
| `logger`     | `Logger`               | Pino logger                      |
| `middleware` | `MiddlewareFunction[]` | Optional middleware chain        |
| `basePath`   | `` `/${string}` ``     | Optional prefix for routes       |

### `POST /trigger`

Accepts an `ExecutionEvent` JSON body. Runs the middleware chain, then calls `invoker.execute`. Returns `{ executionId }` with status 202.

### `POST /events`

Accepts `{ executionId }` JSON body. Blocks until the workflow completes by listening on `invoker.workflowEndEmitter`. Returns the result as JSON, or a serialized error with status 500.

## `createMiddleware(fn)`

Wraps a middleware function for use with `createRoutes`. Middleware receives `(req, event, next, logger)`.

```ts
import { createMiddleware } from "@yieldstar/http-server";

const auth = createMiddleware(async (req, event, next, logger) => {
  const token = req.headers.get("Authorization");
  if (!token) return new Response("Unauthorized", { status: 401 });
  event.context.set("userId", parseToken(token).sub);
  return next();
});
```

The `event.context` is a `FreezableMap`. Middleware can call `.set()` to add entries. After middleware runs, the context is frozen and becomes a read-only `Map` inside the workflow.

Middleware executes in order. Each function must either return a `Response` (to short-circuit) or call `next()` to continue the chain.

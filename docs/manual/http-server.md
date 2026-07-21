# HTTP Server

The HTTP server wraps the same worker and SQLite infrastructure as the local worker in a Bun HTTP server, exposing `/trigger` and `/events` endpoints so clients can start workflows and collect results over the network.

## Server

```ts [server.ts]
import pino from "pino";
import { createRoutes, createMiddleware } from "@yieldstar/http-server";
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";
import { router } from "./shared";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

const db = createSqliteDb({ path: "./.db/http.sqlite" });
new SqliteEventLoop(db).start({ onNewEvent: invoker.execute, logger });

Bun.serve({
  port: 8080,
  routes: {
    "/status": new Response("OK"),
    ...createRoutes({ invoker, logger }),
  },
});
```

## Client

```ts
import { createHttpSdkFactory } from "yieldstar";
import type { Router } from "./shared";

const createSdk = createHttpSdkFactory<Router>();
const sdk = createSdk({ url: "http://localhost:8080" });

const exec = await sdk.trigger({
  workflowId: "my-workflow",
});
await exec.ack();
const result = await exec.waitForResult();
```

## Routes

`createRoutes` registers two POST endpoints:

| Endpoint        | Behavior                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `POST /trigger` | Accepts an `ExecutionEvent` JSON body, invokes the workflow, returns `{ executionId }` with status 202 |
| `POST /events`  | Accepts `{ executionId }`, blocks until the workflow completes, returns the result as JSON             |

An optional `basePath` prefixes both routes:

```ts
createRoutes({ invoker, logger, basePath: "/api/workflows" });
// → POST /api/workflows/trigger
// → POST /api/workflows/events
```

## Middleware

Middleware functions run before the workflow is invoked and can inspect the request, modify the event context, or short-circuit with an early response:

```ts
import { createMiddleware } from "@yieldstar/http-server";

const auth = createMiddleware(async (req, event, next, logger) => {
  const token = req.headers.get("Authorization");
  if (!token) return new Response("Unauthorized", { status: 401 });
  event.context.set("userId", parseToken(token).sub);
  return next();
});

createRoutes({ invoker, logger, middleware: [auth] });
```

Each middleware receives four arguments: `req` (the incoming `Request`), `event` (a `MiddlewareEvent` whose `context` map is mutable at this stage), `next` (a function that forwards to the next middleware or the final handler), and `logger`.

Once every middleware has run, the context map is frozen and passed into the workflow as a read-only `Map` available through `event.context`.

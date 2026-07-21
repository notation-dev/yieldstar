# YieldStar 🤘

JavaScript‑native distributed workflows.

Write workflows as async generator functions that yield steps. Use first‑class primitives for retries, delays, and polling. .

Currently supports running on Bun and Sqlite. Postgres support will be added next.

## Install

Install the core package:

```sh
bun add yieldstar
```

Depending on how you run workflows, also install:

- Local (recommended): `@yieldstar/bun-worker-invoker` and `@yieldstar/sqlite-runtime`
- HTTP server (Bun): `@yieldstar/bun-http-server` and `@yieldstar/bun-worker-invoker`

Note: `@yieldstar/test-utils` is an internal testing helper used by this repository. For local application use, prefer the SQLite runtime.

## Quick Start: Local (SQLite)

Run a workflow locally with persistence and timers using a Bun worker and the SQLite runtime.

```ts
// router.ts
import { workflow, createWorkflowRouter } from "yieldstar";

export const simple = workflow(async function* (step, event, logger) {
  const n = yield* step.run(() => 1);
  yield* step.delay(1000);
  return yield* step.run(() => n * 2);
});

export const router = createWorkflowRouter({ "simple-workflow": simple });
export type Router = typeof router;
```

```ts
// worker.ts
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import { SqliteHeapClient, SqliteTimersClient, SqliteTaskQueueClient, SqliteSchedulerClient, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";
import { router } from "./router";

const logger = pino();
const db = createSqliteDb({ path: "./.db/local.sqlite" });

const runner = new WorkflowRunner({
  router,
  heapClient: new SqliteHeapClient(db),
  schedulerClient: new SqliteSchedulerClient({
    taskQueueClient: new SqliteTaskQueueClient(db),
    timersClient: new SqliteTimersClient(db),
  }),
  logger,
});

createWorkflowWorker(runner, logger).listen();
```

```ts
// app.ts
import pino from "pino";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { createLocalSdk } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

const db = createSqliteDb({ path: "./.db/local.sqlite" });
const loop = new SqliteEventLoop(db);
loop.start({ onNewEvent: invoker.execute, logger });

const sdk = createLocalSdk<import("./router").Router>(invoker);
const result = await sdk.triggerAndWait({ workflowId: "simple-workflow" });
console.log(result); // 2
```

## Pick Your Runtime

### Option A: Local Worker + SQLite (single process)

Use a Bun worker to execute steps and a SQLite‑backed runtime for persistence, timers, and a task queue.

1) Define workflows and a router:

```ts
import { workflow, createWorkflowRouter } from "yieldstar";

export const dynamic = workflow<{ msg: string }, void>(async function* (step, event, logger) {
  const n = yield* step.run(() => Math.random());
  yield* step.delay(1000);
  yield* step.run(() => logger.info(`Hello ${event.params.msg}: ${n}`));
});

export const router = createWorkflowRouter({ "dynamic-workflow": dynamic });
```

2) Create worker and runtime wiring (worker thread):

```ts
// worker.ts
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import { SqliteHeapClient, SqliteTimersClient, SqliteTaskQueueClient, SqliteSchedulerClient } from "@yieldstar/sqlite-runtime/bun";
import { router } from "./router";
import { createSqliteDb } from "@yieldstar/sqlite-runtime/bun";

const logger = pino();
const db = createSqliteDb({ path: "./.db/local.sqlite" });

const runner = new WorkflowRunner({
  router,
  heapClient: new SqliteHeapClient(db),
  schedulerClient: new SqliteSchedulerClient({
    taskQueueClient: new SqliteTaskQueueClient(db),
    timersClient: new SqliteTimersClient(db),
  }),
  logger,
});

createWorkflowWorker(runner, logger).listen();
```

3) Drive the worker from your app and call workflows locally:

```ts
// app.ts
import pino from "pino";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { createLocalSdk } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

const db = createSqliteDb({ path: "./.db/local.sqlite" });
const eventLoop = new SqliteEventLoop(db);
eventLoop.start({ onNewEvent: invoker.execute, logger });

const sdk = createLocalSdk<{ "dynamic-workflow": any }>(invoker);
const res = await sdk.triggerAndWait({ workflowId: "dynamic-workflow", params: { msg: "hello" } });
console.log(res);
```

See a working reference in `examples/local-execution/`.

### Option B: HTTP Server (Bun)

Expose routes to trigger and await workflow results. Use the HTTP SDK as a client.

Server:

```ts
import pino from "pino";
import { createRoutes, createMiddleware } from "@yieldstar/bun-http-server";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";
import { router } from "./router";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

const db = createSqliteDb({ path: "./.db/http.sqlite" });
new SqliteEventLoop(db).start({ onNewEvent: invoker.execute, logger });

const auth = createMiddleware(async (req, event, next) => {
  if (!req.headers.get("Authorization")) return new Response("Unauthorized", { status: 401 });
  return next();
});

Bun.serve({
  port: 8080,
  routes: { "/status": new Response("OK"), ...createRoutes({ invoker, logger, middleware: [auth] }) },
});
```

Client:

```ts
import { createHttpSdkFactory } from "yieldstar";
const createSdk = createHttpSdkFactory<{ "dynamic-workflow": any }>();
const sdk = createSdk({ url: "http://localhost:8080" });

const exec = await sdk.trigger({ workflowId: "dynamic-workflow", params: { msg: "world" } });
await exec.ack();
const result = await exec.waitForResult();
```

See `examples/http-server/` for a complete setup.

## Patterns You’ll Use

### Parameters

Pass data into a run and access it inside the workflow via `event.params`.

```ts
const result = await sdk.triggerAndWait({ workflowId: "w", params: { userId: "123" } });

export const w = workflow(async function* (step, event, logger) {
  logger.info("user:", event.params?.userId);
  return yield* step.run(() => event.params);
});
```

See: `test/params.test.ts`.

### Retries

Throw `RetryableError` inside `step.run` to retry the step with the configured policy.

```ts
import { RetryableError } from "yieldstar";

yield* step.run(async () => {
  // e.g. flaky fetch
  throw new RetryableError("temporary", { maxAttempts: 4, retryInterval: 1000 });
});
```

See: `test/retries.test.ts`.

### Delays and Resumption

Pause until a time in the future and automatically resume.

```ts
yield* step.delay(5000);
```

See: `test/async.test.ts`.

### Polling

Keep checking a predicate until it passes or times out using structured retries.

```ts
yield* step.poll({ retryInterval: 1000, maxAttempts: 10 }, () => isReady());
```

See: `test/polling.test.ts`.

### Cache Keys and Loops

In loops, add explicit cache keys so each iteration is distinct.

```ts
for (let i = 0; i < 2; i++) {
  yield* step.run(`step:${i}`, () => i);
}
```

If omitted, loop detection will raise: “Each step in a loop must have a unique cache key.” See: `test/loop-detection.test.ts`, `test/cache-keys.test.ts`.

### Custom Step‑Like Helpers

Compose your own helpers by yielding built‑in steps under the hood.

```ts
const waitForState = (step: any, logger: any) => async function* (state: string) {
  yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => /* check */ true);
};

export const coordinator = workflow(async function* (step) {
  const a = yield* step.run(() => 2);
  yield* (waitForState(step, console) as any)("enabled");
  return yield* step.run(() => a * 3);
});
```

See: `examples/workflows/coordinator.ts`.

## API Reference

Top‑level exports from `yieldstar`:

```ts
export { createLocalSdk } from "yieldstar";
export { createHttpSdkFactory } from "yieldstar";
export { createWorkflowRouter } from "yieldstar";
export { RetryableError } from "yieldstar";
export { createWorkflow, workflow } from "yieldstar";
export type { WorkflowFn } from "yieldstar";
```

### `workflow(fn)` / `createWorkflow(fn)`

Define a workflow. The function receives `(step, event, logger)` and must be an async generator that yields steps.

```ts
type WorkflowFn<Params, Result, Context> = (
  step: StepRunner,
  event: WorkflowEvent<Params, Context>,
  logger: Logger
) => AsyncGenerator<any, Result>;
```

Return type is inferred; type parameters allow strong typing of `params` and `result`.

### Step Runner

Available on the first argument of a workflow:

```ts
// run
yield* step.run(fn);
yield* step.run("key", fn);

// delay
yield* step.delay(ms);
yield* step.delay("key", ms);

// poll
yield* step.poll({ retryInterval, maxAttempts }, predicate);
yield* step.poll("key", { retryInterval, maxAttempts }, predicate);
```

`RetryableError` inside `fn` signals structured retries:

```ts
new RetryableError(message, { maxAttempts: number, retryInterval: number });
```

### Local SDK

Create a client that triggers workflows using an in‑process `WorkflowInvoker`.

```ts
const sdk = createLocalSdk<Router>(invoker);
await sdk.triggerAndWait({ workflowId, params? });
```

### HTTP SDK

Factory returning a client bound to a base URL.

```ts
const createSdk = createHttpSdkFactory<Router>();
const sdk = createSdk({ url, fetchOptions? });

const exec = await sdk.trigger({ workflowId, params?, context?, executionId? });
await exec.ack();
const result = await exec.waitForResult();
```

### Router

Register your workflows with IDs:

```ts
const router = createWorkflowRouter({ "id": workflow, ... });
type Router = typeof router;
```

Use `Router` to type your SDKs so `workflowId` and `params` are enforced.

## Testing Your Workflows

For repository development we use an in‑memory runtime driven by `@yieldstar/test-utils` to `triggerAndWait` in tests. This package is internal; application users should test against the same runtime they use in production where possible. Example (internal):

```ts
import { test, expect } from "bun:test";
import { createTestSdkFactory } from "@yieldstar/test-utils";
import { createWorkflow } from "yieldstar";

test("data flow between steps", async () => {
  const w = createWorkflow(async function* (step) {
    let n = yield* step.run(() => 1);
    n = yield* step.run(() => n * 2);
    return n;
  });
  const createSdk = createTestSdkFactory();
  const sdk = createSdk({ workflow: w });
  expect(await sdk.triggerAndWait({ workflowId: "workflow" })).toBe(2);
});
```

See more examples in `test/*.test.ts`.

## Notes

- In loops, always add cache keys. Missing keys trigger loop detection.
- `logger` is a Pino logger passed into workflows for observability.
- HTTP middleware can read/set `event.context` before invoking your workflow.

## Contributing

- Please open an issue to discuss significant changes before submitting a PR.
- See CONTRIBUTING.md for repo layout, dev workflow, testing, and release details.

## License

MIT

## Author

[Daniel Grant](https://danielgrant.co)

# Quick Start

A Yieldstar application has three parts: **workflows** that define the work, a **worker** that executes it, and an **app** that triggers it. This guide sets up all three with SQLite persistence.

## Install

```sh
bun add yieldstar @yieldstar/core @yieldstar/bun-worker-invoker @yieldstar/sqlite-runtime
```

## 1. Define a workflow

A workflow is a generator function that yields steps. Each step is a checkpoint, the result of which is persisted by the runtime and can be retrieved if the workflow is paused or needs to be re-run.

```ts [shared.ts]
import { workflow, createWorkflowRouter } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/sqlite-runtime/bun";

export const greet = workflow<{ name: string }, string>(async function* (step, event) {
  const greeting = yield* step.run(() => `Hello, ${event.params.name}`);
  yield* step.delay(1000);
  return yield* step.run(() => `${greeting}!`);
});

export const router = createWorkflowRouter({ greet });
export type Router = typeof router;

export const db = createSqliteDb({ path: "./.db/local.sqlite" });
export const eventLoop = new SqliteEventLoop(db);
```

 `createWorkflowRouter` registers workflows by ID.  Those IDs become the typed keys the SDK uses to trigger them.

## 2. Create the worker

The worker is a subprocess that runs workflow executions in isolation. It connects the `WorkflowRunner` to the SQLite heap (where step results are cached) and the scheduler (which manages timers and retries), then listens for execution events over IPC.

```ts [worker.ts]
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import {
  SqliteHeapClient,
  SqliteSchedulerClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/sqlite-runtime/bun";
import { router, db } from "./shared";

const logger = pino();

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

## 3. Trigger and await the result

The app entry point starts the event loop, creates an invoker that spawns worker subprocesses on demand, and uses the typed SDK to trigger workflows.

```ts [app.ts]
import pino from "pino";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { createLocalSdk } from "yieldstar";
import { eventLoop } from "./shared";
import type { Router } from "./shared";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

eventLoop.start({ onNewEvent: invoker.execute, logger });

const sdk = createLocalSdk<Router>(invoker);
const result = await sdk.triggerAndWait({
  workflowId: "greet",
  params: { name: "World" },
});

console.log(result); // "Hello, World!"
eventLoop.stop();
```

## 4. Run it

```sh
bun app.ts
```

The workflow executes two steps with a 1-second delay between them. 

The first step computes a greeting, the delay pauses execution and persists the resume timestamp to SQLite, and the second step appends punctuation. 

The state lives in `.db/local.sqlite`. 

On resume, completed steps replay from the heap without re-executing.

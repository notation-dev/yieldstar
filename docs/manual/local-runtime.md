# Local Worker (SQLite)

The local worker executes workflows in Bun subprocesses with SQLite-backed persistence. It needs three things: a shared module that owns the workflow definitions and database, a worker process that runs each execution, and an entry point that starts the event loop and invoker. This page wires up each one, then traces the execution path from trigger to completion.

## Shared module

Both the worker and the application need access to the same workflow definitions and database connection, so those live in a shared module. This file declares workflows, registers them in a router, and creates the SQLite database and event loop that the other two files import.

```ts [shared.ts]
import { workflow, createWorkflowRouter } from "yieldstar";
import { SqliteEventLoop, createSqliteDb } from "@yieldstar/bun-sqlite-runtime";

export const myWorkflow = workflow(async function* (step) {
  const n = yield* step.run(() => 1);
  yield* step.delay(1000);
  return yield* step.run(() => n * 2);
});

export const router = createWorkflowRouter({ "my-workflow": myWorkflow });
export type Router = typeof router;

export const db = createSqliteDb({ path: "./.db/local.sqlite" });
export const eventLoop = new SqliteEventLoop(db);
```

## Worker process

Each workflow execution runs in its own Bun subprocess, isolated from the main process. The worker file configures a `WorkflowRunner` with the SQLite-backed heap and scheduler clients, then calls `listen()` to wait for IPC messages from the invoker. When a message arrives, the runner looks up the workflow in the router, replays any cached steps from the heap, and continues execution.

```ts [worker.ts]
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";
import {
  SqliteHeapClient,
  SqliteSchedulerClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/bun-sqlite-runtime";
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

## Application entry point

The application entry point is where you start the event loop, create an invoker, and trigger workflows. `createWorkflowInvoker` takes the path to the worker file and spawns subprocesses on demand. The event loop polls SQLite for pending events and forwards them to the invoker. With the invoker in hand, `createLocalSdk` returns a typed SDK that you use to trigger workflows and await their results.

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
const result = await sdk.triggerAndWait({ workflowId: "my-workflow" });

console.log(result); // 2
eventLoop.stop();
```

## How it works

When you call `sdk.triggerAndWait`, the invoker spawns a new Bun subprocess and sends the execution event over IPC. The subprocess boots the worker, which hands the event to the `WorkflowRunner`. The runner replays any previously cached steps from the SQLite heap, then executes the next new step in the generator.

If the generator yields a delay or a retry, the `WorkflowRunner` calls `schedulerClient.requestWakeUp`, which writes a timer row into SQLite. The subprocess then exits. Meanwhile, the `SqliteEventLoop` in the main process polls the task queue every 10ms. When the timer fires, the event loop enqueues the event, the invoker spawns a fresh subprocess, and the runner replays all cached steps before continuing past the delay.

This cycle of spawn → replay → execute → schedule repeats until the generator returns a `WorkflowResult`. At that point the subprocess sends the result back over IPC, the `workflowEndEmitter` resolves the SDK promise, and the calling code receives the final value.

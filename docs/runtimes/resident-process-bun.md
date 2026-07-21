# Resident process: Bun with SQLite

Use the Bun connector when the coordinator and forked workers run under Bun. It wraps `bun:sqlite` behind the shared synchronous `SqliteDriver` contract.

## Install

```sh
bun add yieldstar @yieldstar/core @yieldstar/sqlite-runtime @yieldstar/worker-invoker
```

## Database and event loop

```ts
import { SqliteEventLoop } from "@yieldstar/sqlite-runtime";
import { createSqliteDb } from "@yieldstar/sqlite-runtime/bun";

export const db = createSqliteDb({ path: "./.db/local.sqlite" });
export const eventLoop = new SqliteEventLoop(db);
```

## Worker

```ts
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import {
  SqliteHeapClient,
  SqliteSchedulerClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/sqlite-runtime";
import { createWorkflowWorker } from "@yieldstar/worker-invoker";
import { db, router } from "./shared";

const logger = pino();
const taskQueueClient = new SqliteTaskQueueClient(db);
const timersClient = new SqliteTimersClient(db);
const runner = new WorkflowRunner({
  router,
  heapClient: new SqliteHeapClient(db),
  schedulerClient: new SqliteSchedulerClient({ taskQueueClient, timersClient }),
  logger,
});

createWorkflowWorker(runner, logger).listen();
```

## Application

```ts
import pino from "pino";
import { createLocalSdk } from "yieldstar";
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";
import { eventLoop } from "./shared";
import type { Router } from "./shared";

const logger = pino();
const workerPath = new URL("./worker.ts", import.meta.url).href;
const invoker = createWorkflowInvoker({ workerPath, logger });

eventLoop.start({ onNewEvent: invoker.execute, logger });
const sdk = createLocalSdk<Router>(invoker);
const result = await sdk.triggerAndWait({ workflowId: "my-workflow" });
eventLoop.stop();
```

Run the application with `bun app.ts`. The child process inherits Bun as `process.execPath`, while the runtime and IPC APIs remain the same as the Node connector path.

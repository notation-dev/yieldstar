# @yieldstar/bun-sqlite-runtime

SQLite-backed implementations of the heap, scheduler, task queue, timers, and event loop. Provides all persistence and scheduling infrastructure for running workflows locally.

## Install

```sh
bun add @yieldstar/bun-sqlite-runtime
```

## `createSqliteDb({ path })`

Creates and returns a Bun `Database` instance at the given file path. Tables are created automatically on first use.

```ts
import { createSqliteDb } from "@yieldstar/bun-sqlite-runtime";

const db = createSqliteDb({ path: "./.db/local.sqlite" });
```

## `SqliteHeapClient`

`HeapClient` implementation backed by SQLite. Stores step results keyed by `(executionId, stepKey)`.

```ts
import { SqliteHeapClient } from "@yieldstar/bun-sqlite-runtime";

const heapClient = new SqliteHeapClient(db);
```

## `SqliteSchedulerClient`

`SchedulerClient` implementation that coordinates the task queue and timers.

```ts
import {
  SqliteSchedulerClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/bun-sqlite-runtime";

const schedulerClient = new SqliteSchedulerClient({
  taskQueueClient: new SqliteTaskQueueClient(db),
  timersClient: new SqliteTimersClient(db),
});
```

## `SqliteEventLoop`

Polls the task queue and timer system on a 10ms interval. When a timer fires, it enqueues the event. When the queue has work, it calls `onNewEvent` for each task.

```ts
import { SqliteEventLoop } from "@yieldstar/bun-sqlite-runtime";

const loop = new SqliteEventLoop(db);
loop.start({ onNewEvent: invoker.execute, logger });
loop.stop();
```

The loop runs three phases per tick:

1. Drain all tasks from the queue, invoking `onNewEvent` for each.
2. Process expired timers and move them into the task queue.
3. Schedule the next tick with `setTimeout(..., 10)`.

# @yieldstar/bun-sqlite-runtime

SQLite-backed implementations of the heap, scheduler, task queue, timers, durable stores, and event loop. Provides all persistence and scheduling infrastructure for running workflows locally.

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

## `SqliteStoreClient`

`StoreClient` implementation backed by SQLite. Store state, waiting workflows,
recorded workflow-step results, and pending wake-ups live in `stores`,
`store_waiters`, `store_applied_steps`, and `store_wake_outbox`.

```ts
import { SqliteStoreClient } from "@yieldstar/bun-sqlite-runtime";

const storeClient = new SqliteStoreClient({ db, schedulerClient });
```

The constructor takes a scheduler as well as the database. When an update
changes a path that a suspended workflow observed, the same conditional
transaction that writes the state and applied-step receipt also records a wake
intent in the outbox. After commit, the client sends pending wake-ups to the
scheduler. Failed deliveries remain pending and are retried after another
committed mutation or when a client starts. A scheduler failure does not fail
an otherwise committed store update or block other pending wake-ups.

Updaters must be synchronous, deterministic, and side-effect-free. They run
against a snapshot outside the SQLite transaction; if the conditional commit
loses a version race, the base store client runs the updater again against the
latest snapshot. The internal write queue serializes SQLite transactions and
outbox delivery for each client.

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

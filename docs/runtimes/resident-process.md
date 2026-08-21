# Resident-process runtime

The resident-process runtime keeps coordination inside the application that owns the workflow service. It is the runtime family available in Yieldstar 0.5.

The long-lived process owns four pieces:

- A `SqliteDriver` connection selected through the Bun or Node connector.
- A `SqliteEventLoop` that moves expired timers into the task queue and dispatches pending executions.
- A `WorkflowInvoker` that forks a fresh child process for each execution.
- A local SDK or HTTP routes that accept trigger requests and observe completed results.

The child process creates a `WorkflowRunner` using heap, scheduler, and store clients connected to the same SQLite file. On every invocation it replays cached steps, executes until the next durable boundary, sends a result when complete, and exits. Delayed and state-suspended workflows resume later in a new child.

## Shared runtime surface

Import runtime clients from the package root and import only the native database factory from a connector entry point:

```ts
import {
  SqliteEventLoop,
  SqliteHeapClient,
  SqliteSchedulerClient,
  SqliteStoreClient,
  SqliteTaskQueueClient,
  SqliteTimersClient,
} from "@yieldstar/sqlite-runtime";
import { createSqliteDb } from "@yieldstar/sqlite-runtime/bun";
```

For Node, change the final import to `@yieldstar/sqlite-runtime/node`. No other runtime wiring changes.

## Connector choice

| Host process | Connector | Native database |
| --- | --- | --- |
| Bun | `@yieldstar/sqlite-runtime/bun` | `bun:sqlite` `Database` |
| Node | `@yieldstar/sqlite-runtime/node` | `node:sqlite` `DatabaseSync` |

Both connectors implement the same synchronous `SqliteDriver` contract. Transactions use `BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK`, and prepared statements expose `get`, `all`, and `run` with named `$parameter` bindings.

## Process requirements

The invoker uses `node:child_process.fork` with advanced IPC serialization so workflow context remains a `Map` across the process boundary. The worker sends a `ready` handshake before the invoker delivers an event; a missing handshake fails after the configured timeout instead of hanging. TypeScript worker paths require Node 22.6 or newer for built-in type stripping. Use compiled JavaScript worker files with older Node releases.

Parent and worker must use the same runtime family. Node must fork Node and Bun must fork Bun because their advanced IPC wire formats are not interoperable. The optional `execPath` can select another executable only within that constraint.

The executable invoker mode and the old `@yieldstar/bun-*` packages were removed in 0.5. Use `@yieldstar/worker-invoker`, `@yieldstar/http-server`, and the appropriate `@yieldstar/sqlite-runtime` connector entry point.

# @yieldstar/worker-invoker

Subprocess-based workflow invoker. Forks a new child process for each workflow execution and communicates via IPC.

## Install

```sh
bun add @yieldstar/worker-invoker
```

## `createWorkflowInvoker({ workerPath, logger })`

Creates a `WorkflowInvoker` that forks a subprocess with `node:child_process`. Each call to `execute` runs the worker with `process.execPath`, sends the execution event via IPC, and waits for a response.

```ts
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";

const invoker = createWorkflowInvoker({
  workerPath: new URL("./worker.ts", import.meta.url).href,
  logger,
});
```

TypeScript worker paths require Node 22.6 or newer for built-in type stripping. Use compiled JavaScript workers on older Node versions.

> **BREAKING:** The former `executable` option has been removed because standalone Bun executables cannot use Node's advanced IPC serialization.

| Param        | Type     | Description                                |
| ------------ | -------- | ------------------------------------------ |
| `workerPath` | `string` | Path or `file://` URL to the worker script |
| `logger`     | `Logger` | Pino logger                                |

The invoker exposes a `workflowEndEmitter` (`EventEmitter`) that fires when a workflow completes or errors. The local SDK listens on this emitter to resolve `triggerAndWait` promises.

When the child sends `{ status: "completed", response }`, the emitter fires the result. When it sends `{ status: "error", error }`, the error is deserialized with `serialize-error` and emitted. Spawn failures reject `execute`; failures or exits after spawning emit an error for that execution. The child process is killed after each message.

## `createWorkflowWorker(runner, logger)`

Creates a worker that listens for IPC messages in the subprocess. Call `.listen()` to start processing.

```ts
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/worker-invoker";

const runner = new WorkflowRunner({ router, heapClient, schedulerClient, logger });
createWorkflowWorker(runner, logger).listen();
```

The worker listens on `process.on("message")`, converts the incoming `MiddlewareEvent` context into a `ReadOnlyMap`, and passes the event to `workflowRunner.run`. The result or error is sent back to the parent via `process.send`.

# @yieldstar/bun-worker-invoker

Subprocess-based workflow invoker for Bun. Spawns a new child process for each workflow execution and communicates via IPC.

## Install

```sh
bun add @yieldstar/bun-worker-invoker
```

## `createWorkflowInvoker({ workerPath, logger })`

Creates a `WorkflowInvoker` that spawns Bun subprocesses. Each call to `execute` runs `bun <workerPath>` as a child process, sends the execution event via IPC, and waits for a response.

```ts
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";

const invoker = createWorkflowInvoker({
  workerPath: new URL("./worker.ts", import.meta.url).href,
  logger,
});
```

| Param        | Type      | Description                                            |
| ------------ | --------- | ------------------------------------------------------ |
| `workerPath` | `string`  | Path or `file://` URL to the worker script             |
| `executable` | `boolean` | If `true`, runs the path directly instead of via `bun` |
| `logger`     | `Logger`  | Pino logger                                            |

The invoker exposes a `workflowEndEmitter` (`EventEmitter`) that fires when a workflow completes or errors. The local SDK listens on this emitter to resolve `triggerAndWait` promises.

When the child sends `{ status: "completed", response }`, the emitter fires the result. When it sends `{ status: "error", error }`, the error is deserialized with `serialize-error` and emitted. The child process is killed after each message.

## `createWorkflowWorker(runner, logger)`

Creates a worker that listens for IPC messages in the subprocess. Call `.listen()` to start processing.

```ts
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflowWorker } from "@yieldstar/bun-worker-invoker";

const runner = new WorkflowRunner({ router, heapClient, schedulerClient, logger });
createWorkflowWorker(runner, logger).listen();
```

The worker listens on `process.on("message")`, converts the incoming `MiddlewareEvent` context into a `ReadOnlyMap`, and passes the event to `workflowRunner.run`. The result or error is sent back to the parent via `process.send`.

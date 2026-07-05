# yieldstar

The main SDK package. Exports the workflow definition API, router factory, retry error class, and both SDK clients.

## Install

```sh
bun add yieldstar
```

## Exports

```ts
import { workflow, createWorkflow } from "yieldstar";
import { createWorkflowRouter } from "yieldstar";
import { RetryableError } from "yieldstar";
import { createLocalSdk } from "yieldstar";
import { createHttpSdkFactory } from "yieldstar";
import type { WorkflowFn } from "yieldstar";
```

## `workflow(fn)` / `createWorkflow(fn)`

Defines a workflow. Returns a `WorkflowGenerator`.

```ts
const w = workflow<Params, Result>(async function* (step, event, logger) {
  return yield* step.run(() => compute());
});
```

| Type parameter | Constraint                    | Description                                  |
| -------------- | ----------------------------- | -------------------------------------------- |
| `Params`       | `Record<string, any> \| void` | Shape of `event.params`                      |
| `Result`       | any                           | Return type of the workflow                  |
| `Context`      | `ReadonlyMap<any, any>`       | Shape of `event.context` (set by middleware) |

## `createWorkflowRouter(workflows)`

Registers workflows with string IDs. Returns the same object, typed for SDK consumption.

```ts
const router = createWorkflowRouter({
  order: orderWorkflow,
  reminder: reminderWorkflow,
});
export type Router = typeof router;
```

## `RetryableError`

Thrown inside `step.run` to trigger structured retries.

```ts
throw new RetryableError(message, { maxAttempts, retryInterval });
```

| Property        | Type     | Description                        |
| --------------- | -------- | ---------------------------------- |
| `maxAttempts`   | `number` | Total attempts including the first |
| `retryInterval` | `number` | Milliseconds between attempts      |

## `createLocalSdk<Router>(invoker)`

Creates a local SDK client. See [Local SDK](../manual/sdk-local.md).

## `createHttpSdkFactory<Router>()`

Returns a factory for HTTP SDK clients. See [HTTP SDK](../manual/sdk-http.md).

## Step runner

Available on the first argument of a workflow function:

```ts
yield * step.run(fn);
yield * step.run("key", fn);

yield * step.delay(ms);
yield * step.delay("key", ms);

yield * step.poll(opts, predicate);
yield * step.poll("key", opts, predicate);
```

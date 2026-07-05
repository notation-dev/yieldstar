# Defining Workflows

A workflow is an async generator function that yields steps. The `workflow()` factory wraps that generator into a `WorkflowGenerator`.

## Basic definition

```ts
import { workflow } from "yieldstar";

const myWorkflow = workflow(async function* (step, event, logger) {
  const a = yield* step.run(() => 1);
  const b = yield* step.run(() => a + 1);
  return b;
});
```

The generator function receives three arguments:

| Argument | Type                             | Description                                                   |
| -------- | -------------------------------- | ------------------------------------------------------------- |
| `step`   | `StepRunner`                     | Exposes `run`, `delay`, and `poll` primitives                 |
| `event`  | `WorkflowEvent<Params, Context>` | Contains `workflowId`, `executionId`, `params`, and `context` |
| `logger` | `Logger` (Pino)                  | Structured logger scoped to the execution                     |

`workflow` and `createWorkflow` are aliases. Both return a `WorkflowGenerator`.

## Type parameters

`workflow()` accepts two type parameters: the input params and the return type.

```ts
const processOrder = workflow<{ orderId: string }, boolean>(async function* (step, event) {
  const order = yield* step.run(() => fetchOrder(event.params.orderId));
  return yield* step.run(() => processPayment(order));
});
```

These types carry through to the SDK when the workflow is registered in a router, so `workflowId`, `params`, and the return type are all enforced at the call site.

## Execution model

Every time the runtime invokes a workflow, the generator replays from the beginning. 

Steps that have already completed return their cached result from the heap with no re-execution and no side effects. 

When the generator reaches a step that has not yet run, it executes the function, persists the result to the heap, and advances. 

If the generator hits a `delay` or a retryable error, it will yield control back to the runtime, which schedules a wake-up and terminates the process.

On the next invocation the same replay happens: cached steps resolve instantly, and the generator picks up where it left off. This means a workflow can span minutes, hours, or days while the process that runs it is ephemeral.

```ts
const w = workflow(async function* (step) {
  // Execution 1: runs, caches result
  // Execution 2: replays from cache
  const a = yield* step.run(() => expensiveComputation());

  // Execution 1: pauses here, schedules wake-up
  // Execution 2: elapsed, continues
  yield* step.delay(5000);

  // Execution 2: runs, caches result
  const b = yield* step.run(() => useResult(a));

  return b;
});
```

## Registering workflows

A router maps string IDs to workflow generators:

```ts
import { createWorkflowRouter } from "yieldstar";

const router = createWorkflowRouter({
  "process-order": processOrder,
  "send-reminder": sendReminder,
});

export type Router = typeof router;
```

Exporting the `Router` type and passing it to the SDK factory gives you type-safe `workflowId` and `params` at every call site.

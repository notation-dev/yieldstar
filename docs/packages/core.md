# @yieldstar/core

Base types, abstract classes, and the `WorkflowRunner` execution engine. This package defines the interfaces that runtime implementations (SQLite, Postgres) must satisfy.

## Install

```sh
bun add @yieldstar/core
```

## `WorkflowRunner`

Executes a workflow generator against the heap and scheduler. The runner advances the generator one step per invocation and mediates between the invoker and the scheduling layer.

```ts
import { WorkflowRunner } from "@yieldstar/core";

const runner = new WorkflowRunner({
  router,
  heapClient,
  schedulerClient,
  storeClient,
  logger,
});
```

| Constructor param | Type              | Description                       |
| ----------------- | ----------------- | --------------------------------- |
| `router`          | `WorkflowRouter`  | Map of workflow IDs to generators |
| `heapClient`      | `HeapClient`      | Step cache implementation         |
| `schedulerClient` | `SchedulerClient` | Timer/wake-up implementation      |
| `storeClient`     | `StoreClient`     | Durable store implementation      |
| `logger`          | `Logger`          | Pino logger                       |

## `HeapClient` (abstract class)

Persistence layer for step results, indexed by `(executionId, stepKey)`.

```ts
abstract readStep(params: {
  executionId: string;
  stepKey: string;
}): Promise<HeapRecord | null>;

abstract writeStep(params: {
  executionId: string;
  stepKey: string;
  stepAttempt: number;
  stepDone: boolean;
  stepResponseJson: string;
}): Promise<void>;
```

## `HeapRecord`

```ts
type HeapRecord = {
  stepResponseJson: string;
  meta: { attempt: number; done: boolean };
};
```

## `SchedulerClient` (interface)

```ts
interface SchedulerClient {
  requestWakeUp(event: WorkflowEvent, resumeIn?: number): Promise<void>;
}
```

## `StoreClient` (abstract class)

Persistence layer for [durable stores](../manual/stores.md). An implementation owns three things: store state and versions, the waiters created when `when`/`take` suspends a workflow, and an applied-steps ledger. The ledger records the result of each committed workflow update, keyed by `(executionId, stepKey)`, so that a replayed step can return the recorded result instead of running its updater again.

```ts
abstract getOrCreateStore(params: {
  definition: StoreDefinition;
  id: string;
  initial?: State | (() => State | Promise<State>);
}): Promise<StoreSnapshot>;

abstract getStore(params: {
  definition: StoreDefinition;
  id: string;
}): Promise<StoreSnapshot>;

abstract updateStore(params: {
  definition: StoreDefinition;
  id: string;
  updater: (draft: Draft) => void | State;
  stepId?: StoreStepId; // identifies the workflow step; keys the applied-steps ledger
}): Promise<StoreUpdateResult>;

abstract takeFromStore(params): Promise<StoreTakeResult>;

abstract registerWaiter(waiter: StoreWaiter): Promise<void>;
```

The base class also provides `storeClient.store(definition, id)`, the external read/write handle described in [External Store Access](../manual/store-external.md).

An implementation must uphold four contracts:

- Each update commits in a single per-store transaction and increments the version by one.
- When `stepId` is provided and the ledger already holds that step, the implementation returns the recorded result and does not run the updater.
- `registerWaiter` compares the store's current version with the waiter's `sinceVersion`; if the store has moved on, it wakes the waiter immediately rather than leaving it to sleep through a write that already happened.
- A waiter is removed only after its wake-up is queued. A crash in between produces a duplicate wake, which replay absorbs – the reverse order would lose the wake entirely.

## `WorkflowInvoker` (type)

```ts
type WorkflowInvoker = {
  workflowEndEmitter: EventEmitter;
  execute(event: ExecutionEvent): Promise<void>;
};
```

## `EventProcessor` (type)

```ts
type EventProcessor = (event: WorkflowEvent, logger: Logger) => Promise<void | WorkflowResult<any>>;
```

## Step response classes

| Class             | Type string          | Description                                         |
| ----------------- | -------------------- | --------------------------------------------------- |
| `StepKey`         | `"step-key"`         | Cache key for the current step                      |
| `StepCacheCheck`  | `"cache-check"`      | Signals the runner to look up cached state          |
| `StepResult`      | `"step-result"`      | Wraps a successful step return value                |
| `StepError`       | `"step-error"`       | Wraps a caught error with optional retry policy     |
| `StepDelay`       | `"step-delay"`       | Carries a `resumeIn` timestamp                      |
| `StepInvalid`     | `"step-invalid"`     | Protocol violation (e.g., missing `yield*`)         |
| `WorkflowResult`  | `"workflow-result"`  | Wraps the workflow's return value                   |
| `WorkflowDelay`   | `"workflow-delay"`   | Emitted by the runner when a delay needs scheduling |
| `WorkflowRestart` | `"workflow-restart"` | Signals the runtime to re-invoke                    |

## Event types

```ts
type TriggerEvent<WorkflowId, Params> = {
  workflowId: WorkflowId;
  executionId?: string;
  params: Params;
  context?: Record<string, any>;
};

type ExecutionEvent<Params> = {
  workflowId: string;
  executionId: string;
  params: Params;
  context?: Record<string, any>;
};

type WorkflowEvent<Params, Context> = {
  workflowId: string;
  executionId: string;
  params: Params;
  context: Context;
};
```

## Middleware types

```ts
type MiddlewareNext = () => Promise<Response>;

type MiddlewareFunction = (
  req: Request,
  event: MiddlewareEvent,
  next: MiddlewareNext,
  logger: Logger,
) => Promise<Response>;
```

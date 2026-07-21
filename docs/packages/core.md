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

Persistence layer for [durable stores](../manual/stores.md). An implementation
owns store state and versions, waiters created by `when`/`take`, an applied-steps
ledger, and wake delivery. The ledger records each committed workflow update by
`(executionId, stepKey)` so replay can return the result without applying the
update again.

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

abstract updateStoreFrom(params: {
  definition: StoreDefinition;
  id: string;
  snapshot: StoreSnapshot;
  updater: (draft: Draft) => void | State;
  stepId?: StoreStepId;
}): Promise<StoreUpdateFromResult>;

abstract listStores(definition: StoreDefinition): Promise<string[]>;
abstract deleteStore(params: { definition: StoreDefinition; id: string }): Promise<void>;
abstract deleteStoreFrom(params): Promise<StoreDeleteFromResult>;

abstract takeFromStore(params): Promise<StoreTakeResult>;

abstract registerWaiter(waiter: StoreWaiter): Promise<void>;
```

The base class also provides `storeClient.store(definition, id)`, the external read/write handle described in [External Store Access](../manual/store-external.md).

An implementation must uphold these contracts:

- Every store instance has a UUIDv7 instance ID; `(definition.name, id)` remains the unique logical lookup key.
- Each update atomically writes the state, increments the version by one, and records its workflow-step result when a `stepId` is present.
- Snapshot-based updates and deletions compare both the instance ID and version.
- When `stepId` is provided and the ledger already holds that step, the implementation returns the recorded result and does not run the updater.
- `registerWaiter` compares the store's current instance and version with the waiter; if either has moved on, it wakes the waiter immediately rather than leaving it to sleep through a write that already happened.
- Matching waiters remain registered until their wake-up is queued. Scheduler
  failures do not reject committed updates, and pending wake-ups are retried by
  later writes. Durable connectors persist wake intents atomically with the
  state change so process interruption cannot lose them.

## `CasStoreClient` (abstract class)

Base class for connectors that support compare-and-swap (CAS). It implements
`updateStore`, `updateStoreFrom`, and `takeFromStore`; a connector supplies
ledger lookup and the atomic mutation operation:

```ts
abstract getAppliedStoreStep(params): Promise<{ result: unknown } | undefined>;

abstract commitStoreMutation(
  mutation: StoreMutation
): Promise<
  | { status: "committed" }
  | { status: "already-applied"; result: unknown }
  | { status: "conflict"; snapshot: StoreSnapshot<unknown> }
>;
```

`commitStoreMutation` checks the applied-step ledger first, compares the
expected instance ID and version, and atomically writes the next state, version,
step result, and any durable wake intents. On conflict it returns the current
snapshot so the base class can recompute the update. Application callbacks run
outside the connector's transaction and may run more than once.

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

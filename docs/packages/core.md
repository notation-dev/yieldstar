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
  logger,
});
```

| Constructor param | Type              | Description                       |
| ----------------- | ----------------- | --------------------------------- |
| `router`          | `WorkflowRouter`  | Map of workflow IDs to generators |
| `heapClient`      | `HeapClient`      | Step cache implementation         |
| `schedulerClient` | `SchedulerClient` | Timer/wake-up implementation      |
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

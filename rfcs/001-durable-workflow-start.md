---
status: proposal
---

# Durable Workflow Start

## Abstract

When a workflow triggers another workflow it is possible – in rare circumstances – for it to be triggered twice. This occurs when a worker crashes right before the durable step receives confirmation that the workflow trigger was successful. In that case the step is replayed and the workflow is triggered again.

To solve this problem, we will introduce `step.start` to 

## Problem

An execution is one run of a durable workflow. It has an execution ID. Yieldstar records each completed step so that the execution can resume after a crash.

Yieldstar has no step for starting another workflow. Authors must call `trigger` inside `step.run`:

```ts
yield* step.run("start:job:job-1", async () =>
  sdk.trigger({
    workflowId: "process-job",
    params: { jobId: "job-1" },
  })
)
```

If `trigger` creates the target and the caller crashes before recording the step, the retry calls `trigger` again. Each call creates a new execution ID, so the target work can run twice.

## Public API

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject

type JsonObject = { [key: string]: JsonValue }

interface StepRunner {
  start(
    key: string,
    target: {
      workflowId: string
      params?: JsonObject
    }
  ): AsyncGenerator<
    StepResponse,
    { executionId: string },
    StepResult | StepError
  >
}
```

For example:

```ts
const target = yield* step.start("start:job:job-1", {
  workflowId: "process-job",
  params: { jobId: "job-1" },
})

// A retry will return this execution ID instead of creating another target.
```

Yieldstar will create and return the target execution ID. The start request will be identified by:

- the caller's execution ID; and
- the step key.

Parameters will accept:

- `null`;
- booleans;
- finite numbers;
- strings;
- arrays with no missing items; and
- objects with string keys whose values follow these same rules.

Parameters will reject:

- missing array items;
- `undefined`;
- functions;
- symbols;
- class instances; and
- reference cycles.

## Runtime API

This RFC will add these types to `@yieldstar/core`:

```ts
interface WorkflowStartClient {
  start(request: {
    requestId: {
      executionId: string
      stepKey: string
    }
    workflowId: string
    params?: JsonObject
  }): Promise<
    | { status: "started"; executionId: string }
    | {
        status: "rejected"
        code: "INVALID_START_PARAMETERS" | "START_REQUEST_MISMATCH"
        message: string
      }
  >
}

interface WorkflowStartError extends Error {
  code: "INVALID_START_PARAMETERS" | "START_REQUEST_MISMATCH"
}

class StepStart extends StepResponse {
  readonly type = "step-start"
  constructor(
    readonly workflowId: string,
    readonly params?: JsonObject
  )
}
```

These types will be exported from `@yieldstar/core`. `WorkflowRunner` will receive a `WorkflowStartClient` and pass it to the workflow driver through `WorkflowGeneratorParams`.

`step.start` will first yield the existing step key and recorded-result check. When no result exists, it will yield `StepStart`.

The workflow driver will then:

1. call `WorkflowStartClient.start`;
2. use the current execution ID and step key as the start-request ID;
3. convert `started` to `StepResult` or `rejected` to `StepError`;
4. record that response; and
5. resume the paused `step.start` generator.

`step.start` will return the execution ID from `StepResult`. It will throw the error from `StepError`.

`WorkflowStartClient` will own start-request records and pending targets. A successful call will make one atomic change that:

1. assigns one target execution ID to the start-request ID; and
2. adds a pending target containing the target workflow ID, execution ID, and parameters.

Other callers will observe both changes or neither. Parameters will match when their JSON encodings match after recursively sorting object keys.

## Delivery acknowledgement

If `WorkflowStartClient` throws, the caller will not know whether the start succeeded. The workflow driver will:

1. record no step;
2. wrap the error in an internal `WorkflowDeliveryRetry`; and
3. pass it through workflow code without allowing that code to catch it.

The child worker will catch this error before its general error handler and reply:

```ts
{ status: "retry" }
```

The worker's replies will have these meanings:

- `completed` and `error` will acknowledge the delivery, so `WorkflowInvoker.execute` will resolve;
- `retry` will not acknowledge the delivery, so `WorkflowInvoker.execute` will reject; and
- a child error or exit before a reply will also make `WorkflowInvoker.execute` reject.

`WorkflowInvoker.execute` will wait for one of those outcomes instead of resolving when the child starts.

The event loop will remove a pending target only when `WorkflowInvoker.execute` resolves. If it rejects, the event loop will:

1. catch the error;
2. leave the target in the queue under its current visibility timeout; and
3. continue polling.

The target will become available again when that timeout expires.

`trigger` will not use the event-loop queue. It will wait for the worker reply and return an invoker rejection to its caller.

## Conformance tests

Runtime-adapter tests will inspect start-request records and pending targets:

| Case | Observable outcome |
| --- | --- |
| Failure after preparing the start-request record but before commit | No start-request record or pending target is visible. |
| Failure after preparing the pending target but before commit | No start-request record or pending target is visible. |
| Commit followed by a lost response | A repeated client call returns the committed execution ID; one start-request record and one matching pending target are visible. |
| Two concurrent calls with one start-request ID | Both return the same execution ID; one start-request record and one matching pending target are visible. |
| Invalid parameters | The client returns `INVALID_START_PARAMETERS`; no start-request record or pending target is visible. |
| A repeated request changes the workflow ID or parameters | The client returns `START_REQUEST_MISMATCH`; the existing start-request record and pending target are unchanged. |
| The target is acknowledged before the caller records its step | The start-request record remains; retrying returns its execution ID without adding another pending target. |

Workflow-driver tests will inspect recorded steps and calls to a fake `WorkflowStartClient`:

| Client behavior or interruption | Observable outcome |
| --- | --- |
| Returns `started` | The execution ID is recorded and returned; replay makes no client call. |
| Returns `rejected` | The error and code are recorded and thrown to workflow code; replay preserves the code and makes no client call. |
| Throws | No step is recorded, workflow code cannot catch the error, and the next execution attempt calls the client again. |
| Caller stops after `started` but before recording the step | The next attempt calls the client with the same start-request ID and records its first execution ID. |

Integration tests will send a pending target through the event loop, invoker, and child worker:

| Child outcome | Observable outcome |
| --- | --- |
| Exits before replying | The invoker rejects, the event loop keeps running, and the same execution is delivered after its visibility timeout. |
| `WorkflowStartClient` throws | The driver records no step, the worker replies `retry`, the invoker rejects, and the same execution is delivered again. |

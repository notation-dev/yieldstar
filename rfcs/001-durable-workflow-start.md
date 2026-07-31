---
status: proposed
created_at: 2026-07-30
---

# Durable Workflow Start

## Abstract

When a workflow triggers another workflow, it is possible – in rare circumstances – for it to be triggered twice. This occurs when a worker crashes after the inner workflow has been created, but before the durable step records completion. In that case, the step is replayed and the inner workflow is triggered again.

To solve this problem, we will introduce `step.start` specifically for starting another workflow as a durable step. If the step is replayed, it will return the original target execution instead of triggering the workflow again.

## Problem

Yieldstar records each completed step so that a workflow can resume after a crash.

Yieldstar has no step for starting another workflow. Authors must call `trigger` inside `step.run`.

```ts
yield* step.run("start:job:job-1", async () => {
  const promisedTarget = sdk.trigger({
    workflowId: "process-job",
    params: { jobId: "job-1" },
  })

  // If the worker crashes here, replay will trigger the workflow again.

  return promisedTarget
})
```

## Proposed solution

`step.start` will start another workflow as a durable step. Replaying it with the same step key will return the first target instead of creating another.

```ts
// Replaying this step will return the same target execution ID.
const target = yield* step.start("start:job:job-1", {
  workflowId: "process-job",
  params: { jobId: "job-1" },
})
```

## Proposed API

`step.start` will take a step key and a target workflow. It will return `{ executionId }` for the target it creates or finds.

```ts
type DurableValue =
  | null
  | boolean
  | number
  | string
  | DurableValue[]
  | DurableObject

type DurableObject = { [key: string]: DurableValue }

type DurableValueEncoding =
  | { status: "encoded"; canonical: string }
  | { status: "invalid"; message: string }

interface DurableValueCodec {
  encode(value: unknown): DurableValueEncoding
}

declare const durableValueCodec: DurableValueCodec

interface StepRunner {
  start(
    stepKey: string,
    target: {
      workflowId: string
      params?: DurableObject
    }
  ): AsyncGenerator<
    StepResponse,
    { executionId: string },
    StepResult | StepError
  >
}
```

The start request will be identified by:

- the caller's execution ID; and
- the step key.

Parameters will accept:

- `null`;
- booleans;
- finite numbers;
- strings;
- arrays with no missing items; and
- plain objects whose values follow these same rules.

A plain object will:

- have the default object prototype or `null`; and
- contain only its own enumerable data properties with string keys.

Parameters will reject:

- accessors;
- symbol or non-enumerable properties;
- missing array items;
- `undefined`;
- functions;
- symbols;
- reference cycles.

Arrays will contain exactly one own data property for every index from zero to `length - 1`, plus the built-in non-enumerable `length` property. Other string or symbol properties and accessors will be invalid.

`@yieldstar/core` will export the `durableValueCodec` value. Its `encode` operation will validate recursively and return either an error message or one canonical JSON string. It will sort object keys and encode `-0` as `0`.

Runtime clients will be the only validation boundary. If parameters are present, `WorkflowStartClient` will call `durableValueCodec.encode` before reading or writing start state. It will return `INVALID_START_PARAMETERS` when encoding fails.

The start-request record will store whether parameters were omitted and will store the canonical string when they are present. Missing parameters and an empty object will not match.

## Runtime API

This RFC will add these types to `@yieldstar/core`:

```ts
interface ExecutionClient {
  admit(request: {
    executionId?: string
  }): Promise<
    | { status: "accepted"; executionId: string }
    | {
        status: "rejected"
        code: "EXECUTION_ID_CONFLICT"
        message: string
      }
  >
}
interface WorkflowStartClient {
  start(request: {
    requestId: {
      executionId: string
      stepKey: string
    }
    workflowId: string
    params?: DurableObject
  }): Promise<
    | { status: "accepted"; executionId: string }
    | {
        status: "rejected"
        code: WorkflowStartErrorCode
        message: string
      }
  >
}

type WorkflowStartErrorCode =
  | "INVALID_START_PARAMETERS"
  | "START_REQUEST_MISMATCH"

declare class ExecutionAdmissionError extends Error {
  readonly code: "EXECUTION_ID_CONFLICT"
}

declare class WorkflowStartError extends Error {
  constructor(
    readonly code: WorkflowStartErrorCode,
    message: string
  )
}

declare class StepStart extends StepResponse {
  readonly type = "step-start"
  constructor(
    readonly workflowId: string,
    readonly params?: DurableObject
  )
}

declare class WorkflowFailed extends StepResponse {
  readonly type = "workflow-failed"
  constructor(readonly error: Error)
}
```

These types will be exported from `@yieldstar/core`. `WorkflowRunner` will receive a `WorkflowStartClient` and pass it to the workflow driver through `WorkflowGeneratorParams`.

`step.start` will first yield the existing step key and recorded-result check. When no result exists, it will yield `StepStart`.

The workflow driver will then:

1. call `WorkflowStartClient.start`;
2. use the current execution ID and step key as the start-request ID;
3. convert `accepted` to `StepResult`;
4. construct a `WorkflowStartError` and convert it to `StepError` when the client returns `rejected`;
5. record that response; and
6. resume the paused `step.start` generator.

`step.start` will return the `{ executionId }` object from `StepResult`. It will throw the error from `StepError`.

`WorkflowStartError` will be the only runtime value for a rejected start. The workflow driver will be its only construction site. Step-error serialization will restore the class and its code on replay.

The runtime will keep three records with separate purposes:

1. An execution-admission record, keyed by execution ID, will reserve that ID across the runtime.
2. A start-request record, keyed by the caller's execution ID and step key, will own the target execution ID, workflow ID, parameter-presence flag, and canonical parameters.
3. A queued target will refer to the start-request record and contain only delivery state.

Execution-admission and start-request records will remain after a queued target is acknowledged. Execution IDs will never be reused.

A successful new start will make one atomic change that:

1. reserves a fresh execution ID;
2. creates the start-request record; and
3. adds one queued target.

`WorkflowStartClient` and `ExecutionClient` will use the same execution-admission table. `WorkflowStartClient` will reserve an ID inside its start transaction. Two start requests will therefore never receive the same execution ID.

Direct `trigger` will call `ExecutionClient.admit` before launching a worker:

- If no execution ID was supplied, `ExecutionClient` will generate IDs until it reserves a new one.
- If the caller supplied an unused ID, `ExecutionClient` will reserve and return it unchanged.
- If the caller supplied an existing ID, `ExecutionClient` will return `EXECUTION_ID_CONFLICT`. The SDK will throw `ExecutionAdmissionError`, and the HTTP trigger route will return `409 Conflict`.
- If worker launch fails after admission, the execution ID will remain reserved. Execution IDs will not be recycled according to launch outcome.

Direct-trigger parameters will remain governed by the existing `TriggerEvent` contract. They will not be stored or encoded by execution admission.

`createLocalSdk` and the HTTP trigger handler will receive an `ExecutionClient`. They will pass the caller's optional execution ID to `admit`, launch only an accepted event, and return the execution ID selected by the client. The HTTP SDK will use the server's accepted ID instead of generating one in the client.

When a start-request record already exists, `WorkflowStartClient` will compare the requested workflow ID, parameter-presence flag, and canonical parameters with that record. Matching requests will return its execution ID. Different requests will return `START_REQUEST_MISMATCH`.

## Delivery acknowledgement

Queue delivery and direct trigger need different acknowledgements. A queued target can be removed only after the workflow reaches a durable outcome. A direct `trigger` needs to know only that its worker started.

```ts
type WorkflowRunOutcome =
  | { status: "completed"; result: unknown }
  | { status: "suspended" }
  | { status: "failed"; error: Error }

interface WorkflowInvoker {
  workflowEndEmitter: EventEmitter
  launch(event: ExecutionEvent): Promise<void>
  deliver(event: ExecutionEvent): Promise<void>
}
```

`workflowEndEmitter` will remain the completion-observation contract used by `triggerAndWait` and the HTTP events route. It will emit a result for `completed` and an error for `failed`. It will not emit for `suspended`.

An operational error from a directly launched invocation will continue to emit an error so an existing completion waiter does not hang. A rejected queued delivery will not emit a completion error because that execution remains eligible for another delivery.

`launch` and `deliver` will acknowledge invocation; neither will become a second completion-observation channel. Each `WorkflowRunOutcome` will mean that the runner has finished the matching durable work:

- `completed` will mean that the workflow result is recorded;
- `suspended` will mean that the unfinished step and every wake needed to resume it are recorded; and
- `failed` will mean that an uncaught workflow error is recorded as the terminal workflow result.

The heap record at the reserved `$$workflow-result$$` step key will own the terminal outcome. It will contain `WorkflowResult` for completion or `WorkflowFailed` for an uncaught workflow error.

Before creating or advancing the user workflow iterator, the workflow driver will read this record. A recorded result will return `completed`; a recorded failure will return `failed`. Workflow code will not run again.

The workflow driver will catch errors only around calls that advance the user workflow iterator. If one of those calls rejects, the driver will serialize the error into `WorkflowFailed`, write it to `$$workflow-result$$`, await that write, and return `failed`.

Heap operations, runtime-client calls, wake scheduling, response deserialization, and invariant checks will run outside that catch. An error from any of them will reject `WorkflowRunner.run`.

Before returning `suspended`, the runner will await the unfinished-step write and every required waiter or scheduler write. In particular, it will await `SchedulerClient.requestWakeUp`.

If `WorkflowStartClient` throws, the driver will record no step and will let the error leave the workflow driver. It will not throw the error into workflow code, so workflow code cannot catch an uncertain runtime failure.

The worker will send a durable outcome only when `WorkflowRunner.run` returns one. If the runner rejects, the worker will reply `retry`. A child error or exit before a durable outcome will have the same meaning.

`WorkflowInvoker.deliver` will resolve without a value after receiving a durable outcome. It will reject after `retry`, a child error, or an early exit. `WorkflowInvoker.launch` will preserve the existing direct-trigger contract by resolving when the child process starts, without waiting for its workflow outcome.

The event loop will remove a queued target only when `WorkflowInvoker.deliver` resolves. If it rejects, the event loop will:

1. catch the error;
2. leave the target in the queue under its current visibility timeout; and
3. continue polling.

The target will become available again when that timeout expires.

Direct `trigger` will not use the event-loop queue. It will call `WorkflowInvoker.launch`, so this RFC will not make it wait for workflow completion or suspension.

`@yieldstar/worker-invoker` and `@yieldstar/test-invoker` will implement the same `launch` and `deliver` contract.

## Conformance tests

Runtime-adapter tests will inspect execution-admission records, start-request records, and queued targets:

| Case | Observable outcome |
| --- | --- |
| Failure after preparing any new start record but before commit | No execution-admission record, start-request record, or queued target is visible. |
| Start commit followed by a lost response | A repeated call returns the committed execution ID; one execution-admission record, one start-request record, and one queued target are visible. |
| Two concurrent calls with one start-request ID | Both return the same execution ID and create only one of each record. |
| Two different start-request IDs | Each receives a different execution ID and execution-admission record. |
| A generated execution ID already exists | The client allocates another ID; the existing admission record is unchanged. |
| Direct admission receives an unused caller-supplied ID | It reserves and returns that exact ID. |
| Direct admission receives an existing caller-supplied ID | It returns `EXECUTION_ID_CONFLICT`; no worker is launched and no existing record changes. |
| Worker launch fails after direct admission | The admitted execution ID remains reserved. |
| Invalid start parameters | `WorkflowStartClient` returns `INVALID_START_PARAMETERS`; no admission, start-request, or queue record is created. |
| Parameter objects have different key order | `durableValueCodec` returns the same canonical string. |
| A repeated request changes the workflow ID or parameters | The client returns `START_REQUEST_MISMATCH`; its admission and start-request records are unchanged. |
| A repeated request changes the descriptor after target acknowledgement | The client returns `START_REQUEST_MISMATCH`; the absence of a queued target does not change the comparison. |
| The target is acknowledged before the caller records its step | The admission and start-request records remain; retrying returns their execution ID without adding another queued target. |

Workflow-driver tests will inspect recorded steps and calls to a fake `WorkflowStartClient`:

| Client behavior or interruption | Observable outcome |
| --- | --- |
| Returns `accepted` | The execution ID object is recorded and returned; replay makes no client call. |
| Returns `rejected` | A `WorkflowStartError` and its code are recorded and thrown to workflow code; replay restores the same class and code without a client call. |
| Returns `INVALID_START_PARAMETERS` | The driver records and throws that rejection after one client call. |
| Throws | No step is recorded, workflow code cannot catch the error, and the next execution attempt calls the client again. |
| Caller stops after `accepted` but before recording the step | The next attempt calls the client with the same start-request ID and records its first execution ID. |

Runner and serialization tests will cover terminal outcomes:

| Case | Observable outcome |
| --- | --- |
| Workflow returns | `WorkflowResult` is stored at `$$workflow-result$$`; replay returns `completed` without executing workflow code. |
| Workflow throws outside a step | `WorkflowFailed` is stored before `failed` is returned; replay returns the same error without executing workflow code. |
| Writing `WorkflowFailed` throws | The runner rejects and no `failed` outcome is returned. |
| Heap, runtime-client, deserialization, invariant, or scheduler operation throws | The runner rejects without storing `WorkflowFailed`. |
| A delay suspends the workflow | The unfinished step and scheduler wake are awaited before `suspended` is returned. |

Delivery tests will cover both invokers, the event loop, direct trigger, and completion observers:

| Delivery or launch outcome | Observable outcome |
| --- | --- |
| Runner returns `completed`, `suspended`, or `failed` | `deliver` resolves without a value and the event loop removes the queued target. |
| Runner rejects, the worker replies `retry`, or the child exits before an outcome | `deliver` rejects, the event loop keeps the queued target, continues polling, and delivers the same execution after its visibility timeout. |
| `WorkflowStartClient` throws | The driver records no step, workflow code cannot catch the error, `deliver` rejects, and the same execution is delivered again. |
| Runner returns `completed` or `failed` | `workflowEndEmitter` emits the result or terminal error. |
| Runner returns `suspended` | `workflowEndEmitter` emits nothing. |
| A queued delivery rejects for retry | `workflowEndEmitter` emits nothing. |
| A directly launched invocation has an operational error | `workflowEndEmitter` emits the error to its existing waiter. |
| Direct `trigger` starts a child whose workflow remains running | `launch` resolves after the child starts without waiting for a workflow outcome. |
| Local or HTTP trigger omits an execution ID | The SDK returns the ID accepted by `ExecutionClient`. |
| Worker and test invokers receive the same event and runner behavior | Their `launch`, `deliver`, and completion-observation behavior match. |

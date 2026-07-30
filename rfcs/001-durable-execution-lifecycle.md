---
status: proposal
created_at: 2026-07-30
---

# Durable Execution Lifecycle

## Abstract

A calling workflow cannot safely retry starting another workflow in Yieldstar. If the calling workflow crashes after the target starts but before Yieldstar records the start, retrying can start the target again.

By introducing `step.start`, we can guarantee that every retry refers to the same target execution. Workflow authors no longer need to detect and repair duplicate target executions.

## Problem

[`StepRunner`](../packages/yieldstar/src/internal/step-runner.ts) has no operation for starting another workflow, so a workflow must call the external [`trigger`](../packages/yieldstar/src/exports/sdk-local.ts) API inside `step.run`. If the new workflow starts and the worker then crashes before `step.run` records its result, running the step again can start the target a second time.

Long-running workflows also need to discard old recorded steps and continue with a fresh history. [`WorkflowRunner`](../packages/core/src/lib/workflow-runner.ts) does not handle the existing [`WorkflowRestart`](../packages/core/src/base/step.ts) response, so the application must stop the old history, start the new one, and prevent them from running together.

### Before

```ts
yield* step.run("start:job:job-1", async () => {
  const result = await sdk.trigger({
    workflowId: "process-job",
    executionId: "job:job-1",
    params: { jobId: "job-1" },
  })

  // If the worker dies here, running this step again can start the target workflow again.
  return result
})
```

## Lifecycle

The runtime owns each execution through `accepted`, `running`, `suspended`, `completed`, `failed`, or `replaced`. The terminal statuses are `completed`, `failed`, and `replaced`; `replaced` is terminal for the old incarnation because responsibility has moved to its replacement.

- The runtime may acknowledge a delivery only after durably recording suspension or a terminal status. Otherwise the execution remains `running` and is redelivered.
- A completed workflow or uncaught non-retryable workflow error must be recorded as a terminal outcome. The recorded `failed` status is where operators discover terminal errors.

An `executionId` names a stable logical identity; each history is one incarnation. Heap rows and store-step receipts are scoped to an incarnation. Today [`HeapClient`](../packages/core/src/base/heap.ts) keys rows only by `executionId` and `stepKey`, so that surface gains an incarnation dimension. Replacement fences the old incarnation, and a late delivery of a fenced incarnation must not execute workflow code.

## Proposal

Add `step.start`. Repeating it with the same step key returns the same target execution instead of starting another:

### After

```ts
// Retrying this step still refers to the same target execution.
yield* step.start("start:job:job-1", {
  workflowId: "process-job",
  executionId: "job:job-1",
  params: { jobId: "job-1" },
})
```

## Proposed API

```ts
interface StepRunner {
  start<Params>(
    key: string,
    event: {
      workflowId: string
      executionId: string
      params?: Params
    }
  ): AsyncGenerator<StepResponse, void>
}
```

`start` returns no value because the target identity is caller-supplied.

## Required Semantics

- The target's `accepted` record and the caller's step record must commit before the target becomes eligible for delivery, in one atomic decision. Retrying after any crash cannot create a duplicate.
- `start` is idempotent on `executionId` across callers: the same `workflowId` and `params` refer to the existing execution; a different `workflowId` or `params` must fail.
- Once `start` succeeds, the target must remain eligible to run even if the worker crashes before scheduling it.
- `start` does not imply a parent-child hierarchy or wait for the target's result.

## Continue as New

```ts
interface StepRunner {
  continueAsNew<Params>(event: {
    params?: Params
  }): AsyncGenerator<WorkflowContinueAsNew<Params>, never>
}
```

`continueAsNew` yields a `WorkflowContinueAsNew<Params>` response carrying the replacement parameters. It replaces the unhandled [`WorkflowRestart`](../packages/core/src/base/step.ts), which carries no payload and cannot deliver them.

- The replacement is a new incarnation of the same `executionId` and `workflowId`.
- Replacement atomically fences the old incarnation; a late delivery of that incarnation must not execute workflow code.
- The new incarnation has fresh heap and store-step receipt namespaces, even when it repeats the same business-keyed step keys.
- After fencing, the runtime must eventually remove every record scoped only to that incarnation: heap rows, store-step receipts, waiters, and timers. Removing a receipt before fencing could let a late delivery repeat its mutation.

## Acceptance Histories

An implementation must explain these histories:

1. The target starts, but the calling workflow crashes before recording the `start` result. Retrying `start` does not create another target execution.
2. `start` succeeds, but the worker crashes before the scheduler runs the target. The target remains eligible to run.
3. Continue-as-new happens while the scheduler is also trying to run the old history. Only the replacement runs workflow code.
4. A worker crashes during continue-as-new. Recovery leaves one current history, not both and not neither.
5. After continue-as-new, the replacement repeats a business-keyed step key from the old history and does not observe the old incarnation's recorded result.

## Not Specified

This RFC does not choose the storage transaction or recovery protocol behind `start`, record schemas, the shape of the incarnation dimension on heap and store-step receipt surfaces, the equality definition for `params`, scheduler implementation, or cleanup timing.

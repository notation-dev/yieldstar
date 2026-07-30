---
status: proposal
created_at: 2026-07-30
---

# Durable Workflow Start and Replacement

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
      params: Params
    }
  ): AsyncGenerator<StepResponse, void>
}
```

## Required Semantics

- Repeating `start` with the same calling step key must refer to the same target execution.
- Reusing an `executionId` with different workflow parameters must fail rather than reinterpret the identity.
- Once `start` succeeds, the target must remain eligible to run even if the worker crashes before scheduling it.
- A system failure may cause another attempt. A completed workflow or uncaught non-retryable workflow error must be recorded as an outcome and must not be retried indefinitely.
- `start` does not imply a parent-child hierarchy or wait for the target's result.

## Continue as New

```ts
interface StepRunner {
  continueAsNew<Params>(event: {
    params: Params
  }): AsyncGenerator<WorkflowRestart, never>
}
```

Continue-as-new gives the existing [`WorkflowRestart`](../packages/core/src/base/step.ts) response its runtime meaning. No separate restart response remains.

- The replacement keeps the same `executionId` and `workflowId` with new parameters.
- The old history cannot run workflow code after the replacement becomes current.
- The replacement starts with no recorded step results from the old history.
- Records belonging only to an old history may be removed after that history can no longer run.

## Acceptance Histories

An implementation must explain these histories:

1. The target starts, but the calling workflow crashes before recording the `start` result. Retrying `start` does not create another target execution.
2. `start` succeeds, but the worker crashes before the scheduler runs the target. The target remains eligible to run.
3. Continue-as-new happens while the scheduler is also trying to run the old history. Only the replacement runs workflow code.
4. A worker crashes during continue-as-new. Recovery leaves one current history, not both and not neither.

## Not Specified

This RFC does not choose the storage transaction or recovery protocol behind `start`, internal lifecycle states, record schemas, scheduler implementation, or cleanup timing.

---
status: proposal
created_at: 2026-07-30
---

# Timed Store Wait

## Abstract

Many workflows need to wait for a store change, but only until a deadline. Yieldstar cannot express the store condition and timer in one step, pushing responsibility for the deadline into the application layer.

We can solve this by letting `WorkflowStore.when` accept the store condition and a deadline, then race them within a single durable step. Whichever wins becomes the step's only result, so the workflow handles either the store change or the timeout, never both.

## Problem

[`WorkflowStore.when`](../packages/yieldstar/src/internal/step-runner.ts) pauses the workflow before a later `step.delay` can start. Reversing the calls does not help: `step.delay` then pauses the workflow, so a store change cannot resume it.

The application can repeatedly check the store, which delays responses and repeatedly runs code when nothing has changed. Alternatively, it can start a second workflow for the timer and store whether the condition or timeout won, solely to prevent both workflows from acting. After the wait settles, that second workflow's timer cannot be cancelled and later fires as a no-op.

### Before

```ts
const approval = yield* step.store(ApprovalStore, { id: approvalId })

const decision = yield* approval.when(
  `decision:${approvalId}`,
  state => state.decision
)

// This timer does not start until a decision exists, so it cannot enforce the deadline.
yield* step.delay("approval-deadline", deadline - Date.now())
```

## Proposal

Add an absolute deadline to `WorkflowStore.when`. The condition and timer finish one durable step, and the runtime cancels whichever wait remains:

### After

```ts
// RFC 003 makes store handle access non-durable.
const approval = step.store(ApprovalStore, { id: approvalId })

// The condition and timer can both finish this step, but only the first result is kept.
const result = yield* approval.when(
  `decision:${approvalId}`,
  state => state.decision,
  { deadline }
)

if (result.status === "timed-out") {
  // record expiry if no decision won first
}
```

## Proposed API

`when` gains an overload. The existing form without a deadline is unchanged and still returns `NonNullable<R>`; only the timed form returns `TimedWhenResult<R>`. The timed form always takes an explicit key and has no keyless variant.

```ts
type TimedWhenResult<R> =
  | {
      status: "matched"
      value: NonNullable<R>
    }
  | {
      status: "timed-out"
    }

interface WorkflowStore<T> {
  when<R>(
    key: string,
    selector: StoreSelector<T, R | undefined | null | false>,
    options: { deadline: number }
  ): AsyncGenerator<StepResponse, TimedWhenResult<R>>
}
```

## Required Semantics

- The deadline is an absolute timestamp.
- On arming, the runtime evaluates the selector first. A matching state wins as `matched` even when the deadline has already passed; otherwise a past deadline returns `timed-out` immediately.
- The store condition and timer compete to complete one durable step.
- The first recorded result is the only result returned to workflow code.
- The execution counts as durably suspended under [RFC 001](./001-durable-execution-lifecycle.md), and its delivery may be acknowledged, only after both the store waiter and timer are installed or the step has already resolved. A crash while arming leaves the execution running, and the lifecycle's redelivery completes the arming; no lost-wakeup window exists.
- Recording the winning result removes the losing registration, either the remaining waiter or timer. It cannot run workflow code, repeating the cleanup after a crash is safe, and a timer with no remaining effect must not survive to fire as an application-visible no-op.
- The deadline cannot complete the wait before its timestamp; the runtime does not promise to resume the workflow immediately.
- The existing form of `when` without a deadline remains unchanged.

## Scope

This RFC does not add a general operation for waiting on several stores. A timed store wait covers one store condition and one deadline.

## Acceptance Histories

An implementation must explain these histories:

1. The selector matches before the deadline. The workflow receives the value and the timer is removed.
2. The timer finishes the wait first. A later matching store update cannot replace the timeout result.
3. A matching store change happens at the deadline. One durable result wins, and a restart returns the same result.
4. The worker crashes after installing one of the two wakes. Redelivery finishes arming; no outcome is lost and no recorded winner changes.
5. The wait resolves, then the worker crashes before cleanup completes. Repeating the cleanup removes the losing registration without further effect.

## Not Specified

This RFC does not choose how the wait and timer are stored, how ties are ordered beyond the first recorded result, or when cleanup runs within the resolution.

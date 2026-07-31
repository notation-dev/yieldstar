---
status: proposal
created_at: 2026-07-30
---

# Timed Store Wait

## Abstract

Many workflows need to wait for a store change, but only until a deadline. Yieldstar cannot express the store condition and timer in one step, meaning that it becomes the application's responsibility to coordinate them.

We can solve this by letting `WorkflowStore.when` accept both a store condition and a deadline that race to finish within one durable step. This will allow develoeprs to interlace timing conditions without extra ceremony.

## Problem

[`WorkflowStore.when`](../packages/yieldstar/src/internal/step-runner.ts) pauses the workflow before a later `step.delay` can start. Reversing the calls does not help: `step.delay` then pauses the workflow, so a store change cannot resume it.

The application has two workarounds:

- Repeatedly check the store. This delays responses and runs code when nothing has changed.
- Start a second workflow for the timer, then store whether the condition or timeout won. This extra state exists only to prevent both workflows from acting.

The second workflow's timer cannot be cancelled after the wait settles. It will later fire and do nothing.

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

`WorkflowStore.when` will accept an absolute deadline. The condition and timer will finish one durable step, and the runtime will cancel whichever wait remains:

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

`when` will gain an overload:

- The existing form without a deadline will remain unchanged and return `NonNullable<R>`.
- Only the timed form will return `TimedWhenResult<R>`.
- The timed form will always take an explicit key. It will have no keyless variant.

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

- The deadline will be an absolute timestamp.
- When the wait starts, the runtime will evaluate the selector first.
- A matching state will win as `matched`, even when the deadline has already passed.
- If the selector does not match, a past deadline will return `timed-out` immediately.
- The store condition and timer will compete to complete one durable step.
- The first recorded result will be the only result returned to workflow code.
- A delivery will be acknowledged only after both the store waiter and timer are installed, or after the step has resolved.
- If the worker crashes earlier, the delivery will be retried and will complete the setup.
- Recording the winning result will remove the losing registration: either the remaining waiter or the timer.
- Cleanup will not run workflow code. Repeating it after a crash will therefore be safe.
- A timer with no remaining effect will be removed instead of surviving to fire as an application-visible no-op.
- The deadline will not complete the wait before its timestamp.
- The runtime will not promise to resume the workflow immediately after the timestamp.
- The existing form of `when` without a deadline will remain unchanged.

## Scope

This RFC will not add a general operation for waiting on several stores. A timed store wait will cover one store condition and one deadline.

## Acceptance Histories

An implementation must explain these histories:

1. The selector matches before the deadline. The workflow receives the value and the timer is removed.
2. The timer finishes the wait first. A later matching store update cannot replace the timeout result.
3. A matching store change happens at the deadline. One durable result wins, and a restart returns the same result.
4. The worker crashes after installing one of the two wakes. Redelivery finishes arming; no outcome is lost and no recorded winner changes.
5. The wait resolves, then the worker crashes before cleanup completes. Repeating the cleanup removes the losing registration without further effect.

## Not Specified

This RFC will not choose:

- how the wait and timer are stored;
- how ties are ordered beyond the first recorded result; or
- when cleanup runs within the resolution.

---
status: proposal
created_at: 2026-07-30
---

# Re-entrant Workflow Store Handles

## Abstract

`step.store` treats obtaining a store handle — the value used to read, wait on, or change a store — as a durable step. Consequently, a loop or helper that asks for the same store is rejected unless every caller shares the first handle or coordinates a cache.

Obtaining a store handle, however, does not need to be a step at all. Making handle access re-entrant simplifies the API and leaves durability only on store creation, reads, waits, and writes.

## Problem

`step.store` currently creates the store if necessary and returns a handle for later operations. Because obtaining that handle is itself a durable step keyed by the store definition and id, asking for the same store again repeats the step key and is rejected.

Obtaining the same handle more than once is useful when a loop processes several items from one store or when separate helper functions use that store. Those callers should not need to know who obtained the first handle.

### Before

```ts
async function* addTask(step, projectId, task) {
  // This helper obtains the handle it needs instead of receiving shared setup state.
  const project = yield* step.store(ProjectStore, { id: projectId })
  yield* project.update(`add:${task.id}`, draft => {
    draft.tasks.push(task)
  })
}

yield* step.store(ProjectStore, {
  id: projectId,
  initial: { projectId, tasks: [] },
})

// The helper asks for the same store, so its step.store call is rejected.
yield* addTask(step, projectId, task)
```

## Proposal

Return a store handle immediately each time it is requested, and move durable initialization to an explicit `getOrCreate` operation. `step.store` no longer accepts `initial`; the parameter is removed, not made optional.

### After

```ts
async function* addTask(step, projectId, task) {
  // Obtaining this handle records no step, so helpers can request it independently.
  const project = step.store(ProjectStore, { id: projectId })
  yield* project.update(`add:${task.id}`, draft => {
    draft.tasks.push(task)
  })
}

const project = step.store(ProjectStore, { id: projectId })

// Store creation remains a durable operation with its own step key.
yield* project.getOrCreate(`create:${projectId}`, {
  projectId,
  tasks: [],
})

yield* addTask(step, projectId, task)
```

## Proposed API

```ts
interface StepRunner {
  store<Schema extends StandardSchemaV1>(
    definition: StoreDefinition<Schema>,
    params?: {
      id?: string
    }
  ): WorkflowStore<StoreState<Schema>>
}

interface WorkflowStore<T> {
  getOrCreate(
    key: string,
    initial: T | (() => T | Promise<T>)
  ): AsyncGenerator<StepResponse, StoreSnapshot<T>>
}
```

`WorkflowStore` keeps its existing durable operations (`get`, `select`, `update`, `updateFrom`, `deleteFrom`, `when`, `take`) and its readonly `definition`, `id`, and `key` properties unchanged, gaining only `getOrCreate`.

If `id` is omitted, `step.store` uses `event.executionId`. This is the logical execution identity of [RFC 001](./001-durable-execution-lifecycle.md), stable across continue-as-new, so a replacement incarnation reopens the same store.

## Required Semantics

- Store identity remains `definition.name + id`. Store identity and state are not incarnation-scoped; the durable receipts of `getOrCreate`, reads, waits, and writes follow RFC 001's incarnation scope like any other step record.
- Asking for a handle does not read, create, or change the store and records no workflow step. A handle does not imply that the store exists; every operation except `getOrCreate` fails if it does not. This is where today's missing-store step failure moves.
- Repeated requests for the same identity return handles for the same store.
- Creation is idempotent on store identity: concurrent or repeated initialization records exactly one initial state. Each `getOrCreate` call is a durable step on its own caller-supplied key, whose recorded result is the snapshot that call observed, whether it created the store or found it existing.
- `getOrCreate` evaluates `initial` only when the store does not exist.
- A crash after store creation but before the workflow records the result does not create the store again.

## External Access

[`RuntimeStore`](../packages/core/src/base/store.ts) in `@yieldstar/core` exposes `get`, `update`, `updateFrom`, and `deleteFrom`, but it does not expose creation. The same package publicly exports `StoreClient.getOrCreateStore`, which already owns external creation:

```ts
await storeClient.getOrCreateStore({
  definition: ProjectStore,
  id: projectId,
  initial,
})
```

This RFC does not duplicate creation on `RuntimeStore`. Code outside a workflow can use the public `StoreClient` method. `StoreClient.getOrCreateStore` keeps its optional `initial`, while workflow-level `getOrCreate` requires it; the two surfaces are not to be harmonised.

## Acceptance Histories

An implementation must explain these histories:

1. A loop asks for the same project handle on several turns, and a helper reopens it independently with no application cache. Handle access never creates a repeated step-key error.
2. Two executions initialize one store at the same time. Exactly one initial state is recorded, and each `getOrCreate` step records the snapshot it observed.
3. A workflow crashes after creating the store but before recording the workflow step result. Running it again returns the existing store and does not recreate it.
4. Continue-as-new replaces the incarnation. The replacement reopens the same logical store and state with fresh step receipts.

## Not Specified

This RFC does not choose whether equivalent handles are the same JavaScript object, whether handles are cached, or how `getOrCreate` records its durable result.

---
status: proposal
created_at: 2026-07-30
---

# Re-entrant Workflow Store Handles

## Abstract

Currently, `step.store` creates a durable step every time a store handle is requested. A loop or helper that asks for the same store must therefore share the first handle, adding setup that is unrelated to the work it performs.

It turns out that obtaining a store handle does not need to be a durable step at all. With this change, callers will be able to request the same handle independently, while store creation, reads, waits, and writes will remain durable.

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

`step.store` will return a store handle immediately each time it is called. An explicit `getOrCreate` operation will perform durable initialization.

`step.store` will no longer accept `initial`. The parameter will be removed, not made optional.

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

`WorkflowStore` will gain only `getOrCreate`. It will keep:

- the existing durable operations `get`, `select`, `update`, `updateFrom`, `deleteFrom`, `when`, and `take`; and
- the readonly properties `definition`, `id`, and `key`.

If `id` is omitted, `step.store` will use `event.executionId`. Calls from the same workflow execution will therefore open the same store.

## Required Semantics

- Store identity will remain `definition.name + id`.
- Store identity and state will not be scoped to a workflow execution.
- Each recorded store step will be scoped to the execution that calls it.
- Asking for a handle will not read, create, or change the store.
- Asking for a handle will record no workflow step.
- A handle will not imply that the store exists. Every operation except `getOrCreate` will fail if the store does not exist. This is where today's missing-store step failure will move.
- Repeated requests for the same identity will return handles for the same store.
- Concurrent or repeated initialization will record exactly one initial state for each store identity.
- Each `getOrCreate` call will be a durable step with its own caller-supplied key.
- Each call will record the snapshot it observed, whether it created the store or found it already existed.
- `getOrCreate` will evaluate `initial` only when the store does not exist.
- A crash after store creation but before the workflow records the result will not create the store again.

## External Access

[`RuntimeStore`](../packages/core/src/base/store.ts) in `@yieldstar/core` currently exposes `get`, `update`, `updateFrom`, and `deleteFrom`. It does not expose creation.

The same package already exports `StoreClient.getOrCreateStore` for code outside a workflow:

```ts
await storeClient.getOrCreateStore({
  definition: ProjectStore,
  id: projectId,
  initial,
})
```

This RFC will not add creation to `RuntimeStore`. Code outside a workflow will continue to use the public `StoreClient` method.

The two APIs will deliberately differ:

- `StoreClient.getOrCreateStore` will keep its optional `initial`; and
- workflow-level `getOrCreate` will require `initial`.

## Acceptance Histories

An implementation must explain these histories:

1. A loop asks for the same project handle on several turns, and a helper reopens it independently with no application cache. Handle access never creates a repeated step-key error.
2. Two executions initialize one store at the same time. Exactly one initial state is recorded, and each `getOrCreate` step records the snapshot it observed.
3. A workflow crashes after creating the store but before recording the workflow step result. Running it again returns the existing store and does not recreate it.
4. Continue-as-new replaces the incarnation. The replacement reopens the same logical store and state with fresh step receipts.

## Not Specified

This RFC will not choose:

- whether equivalent handles are the same JavaScript object;
- whether handles are cached; or
- how `getOrCreate` records its durable result.

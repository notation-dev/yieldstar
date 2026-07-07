# Durable Stores

A store is schema-validated state that lives outside any single workflow execution. Workflows read and update it through durable steps; external code can write to it too. This one primitive covers long-lived agents, mailboxes, shared project state, and human approval flows – without a separate concept for each.

## Defining a store

`defineStore` creates a store _type_, not an instance. It takes a name and any [Standard Schema](https://standardschema.dev/) – Zod, Valibot, and ArkType all work.

```ts
import { defineStore } from "yieldstar";
import * as v from "valibot";

const ConversationStore = defineStore(
  "conversation",
  v.object({
    messages: v.array(
      v.object({
        id: v.string(),
        content: v.string(),
        processed: v.optional(v.boolean(), false),
      })
    ),
    status: v.picklist(["idle", "working"]),
  })
);
```

The schema is validated when a store is created and after every update – a bad write fails before it commits, never after.

## Creating and opening a store

`step.store` returns a handle. If the store does not exist yet, it is created from `initial`; if it does, the existing store is returned and `initial` is ignored.

```ts
const store = yield* step.store(ConversationStore, {
  id: event.params.conversationId,
  initial: { messages: [], status: "idle" },
});
```

Store identity is `name + id`. Omit the `id` and it defaults to `event.executionId`, giving you execution-local state:

```ts
const store = yield* step.store(ScratchStore, { initial: {} });
```

Pass an explicit `id` to share one store across executions – a conversation id, an agent id, a project id. If the store does not exist and no `initial` is provided, the step fails.

## Reading

`store.get` returns a snapshot: the state plus a monotonic version number.

```ts
const { state, version } = yield* store.get("load");
```

`store.select` runs a pure selector and persists only the selected value:

```ts
const unprocessed = yield* store.select("unprocessed", (s) =>
  s.messages.filter((m) => !m.processed)
);
```

Reads are durable steps. The first execution reads the latest committed state; replays return the recorded snapshot, never whatever the store contains later. A _new_ read step may observe newer state – workflows are long-running, so this is deliberate. Each completed read is replay-stable; the workflow as a whole is not one big snapshot transaction.

## Updating

`store.update` mutates a draft. The update is atomic, schema-validated, and bumps the version by exactly one.

```ts
yield* store.update(`finish:${msg.id}`, (draft) => {
  const message = draft.messages.find((m) => m.id === msg.id)!;
  message.processed = true;
  draft.status = "idle";
});
```

Updates are exactly-once per step key. On replay the cached result is returned and the updater does not re-run – and this holds even if the previous run crashed between committing the store and recording the step, because the store keeps its own ledger of applied steps inside the same transaction as the state change.

Keep updaters synchronous and pure. The signature allows async, but an updater holds the store's write transaction open while it runs – no network calls, no timers.

## Waiting

To pause a workflow until the store reaches some condition, see [Waiting on State](./store-waiting.md).

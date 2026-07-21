# External Store Access

Stores are not workflow-only. Any code with a `StoreClient` – an HTTP handler, a webhook receiver, a CLI – can read and write a store directly. This is how events get _into_ the system: an external write wakes any workflow that is waiting on the state it changed.

## Getting a handle

`storeClient.store(definition, id)` returns a plain async handle – no workflow, no steps.

```ts
import { SqliteStoreClient } from "@yieldstar/bun-sqlite-runtime";
import { ConversationStore } from "./shared";

const storeClient = new SqliteStoreClient({ db, schedulerClient });

const conversation = storeClient.store(ConversationStore, "conversation:123");
```

The constructor takes a scheduler as well as the database. When a write changes state that a suspended workflow is waiting on, the store client hands that workflow's event to the scheduler, which queues it for re-execution. See [Local Runtime](./local-runtime.md) for the full wiring.

## Reading

```ts
const { state, instanceId, version } = await conversation.get();
```

`instanceId` is an internal UUIDv7 assigned when the store is created. It stays
the same for the lifetime of that store. Deleting and recreating the same
logical definition and ID assigns a new instance ID and resets the version to
zero.

## Writing

`update` takes the same synchronous, pure draft-mutating updater as the workflow
API. The runtime validates the resulting state and conditionally commits one
version increment. A version conflict may re-run the updater against newer
state.

External updates do not carry a workflow `stepId`. If an update rejects after
the state committed but wake delivery failed, blindly retrying can apply it
twice. Read the store and reconcile before deciding whether to retry.

```ts
await conversation.update((draft) => {
  draft.messages.push({
    id: crypto.randomUUID(),
    content: "hello",
    processed: false,
  });
});
```

If a workflow is suspended on `store.when` or `store.take` over `s.messages`, this write wakes it. That is the whole event-ingestion story: the webhook handler writes state, and the workflow that cares about that state resumes.

When a write or deletion depends on an earlier snapshot, use the conditional
operations:

```ts
const snapshot = await conversation.get();

const updated = await conversation.updateFrom(snapshot, (draft) => {
  draft.status = "synced";
});

const current = await conversation.get();
const deleted = await conversation.deleteFrom(current);
```

They commit only if both `instanceId` and `version` still match. `StoreClient`
also exposes `listStores(definition)`, which returns sorted live logical IDs,
and idempotent unconditional `deleteStore({ definition, id })` for
administrative cleanup.

## The pattern in full

```ts
// HTTP handler – external side
app.post("/conversations/:id/messages", async (req) => {
  await storeClient
    .store(ConversationStore, req.params.id)
    .update((draft) => {
      draft.messages.push(req.body);
    });
  return new Response("ok");
});

// Workflow – waiting side
const msg = yield* store.take(
  `next:${turn}`,
  (s) => s.messages.find((m) => !m.processed),
  (draft, m) => {
    draft.messages.find((x) => x.id === m.id)!.processed = true;
  }
);
```

External updates sit outside workflow step caching. There is no step key, so each call applies once, when it runs. If your handler retries, idempotency is yours to manage.

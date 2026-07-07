# External Store Access

Stores are not workflow-only. Any code with a `StoreClient` – an HTTP handler, a webhook receiver, a CLI – can read and write a store directly. This is how events get _into_ the system: an external write wakes any workflow waiting on the paths it changed.

## Getting a handle

`storeClient.store(definition, id)` returns a plain async handle – no workflow, no steps.

```ts
import { SqliteStoreClient } from "@yieldstar/bun-sqlite-runtime";
import { ConversationStore } from "./shared";

const storeClient = new SqliteStoreClient({ db, schedulerClient });

const conversation = storeClient.store(ConversationStore, "conversation:123");
```

The client needs the scheduler because writes wake waiting workflows – see [Local Runtime](./local-runtime.md) for the full wiring.

## Reading

```ts
const { state, version } = await conversation.get();
```

## Writing

`update` takes the same draft-mutating updater as the workflow API. It is atomic, schema-validated, and bumps the version by one.

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

External updates do not participate in workflow step caching – there is no step key, so each call applies once, when it runs. Idempotency across retries of your _own_ handlers is yours to manage.

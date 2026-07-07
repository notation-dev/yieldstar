# Waiting on State

Two primitives suspend a workflow until a store reaches some condition: `when` observes, `take` consumes. Neither polls. The execution terminates, and the runtime re-invokes it when a relevant write commits.

## `store.when`

`when` waits once for a condition and returns the selected value. It does not mutate the store.

```ts
const message = yield* store.when((s) =>
  s.messages.find((m) => !m.processed)
);
```

If the selector already returns a truthy value, the workflow continues immediately. Otherwise the execution suspends. When a later write touches something the selector read, the workflow replays and the selector re-evaluates.

Inside a loop, pass an explicit key – the same call site is reached more than once, so the call-site key collides:

```ts
const message = yield* store.when(`next-message:${turn}`, (s) =>
  s.messages.find((m) => !m.processed)
);
```

## How wake-ups work

The selector runs against a tracking proxy – a wrapper around the state that records which paths the selector read. If the selector does not match, the runtime stores those paths alongside the suspended execution.

When an update later writes to an overlapping path, the runtime re-enqueues the workflow. Appending to `messages` wakes a selector that read `s.messages`; replacing `profile` wakes a selector that read `s.profile.name`. A write to `status` does not wake a selector that only read `messages`.

Why does this matter? Because the selector itself is never serialised. The recorded paths are only a wake-up filter – on wake, the workflow replays and the selector re-runs against the real committed state. If a wake turns out to be spurious, the selector re-evaluates to falsy and the execution suspends again.

Selectors must be synchronous and pure: no network, no timers, no mutation (the proxy throws if you try). The selected value is persisted as the step result, so it must be serialisable.

## `store.take`

`when` observes; it does not claim. If two executions both `when` on the same unprocessed message, both receive it. For mailboxes and queues where exactly one consumer should win each item, use `take`:

```ts
const msg = yield* store.take(
  `next:${turn}`,
  (s) => s.messages.find((m) => !m.processed),
  (draft, msg) => {
    draft.messages.find((m) => m.id === msg.id)!.processed = true;
  }
);
```

The selector and the claim run inside the _same_ store transaction, committing as one version bump. When two workers race, one commits its claim first. The other's selector then re-evaluates against the claimed state, finds the message already processed, and moves on – so both workers cannot receive the same message.

`take` requires an explicit key, and the claim mutation follows the same rules as an updater.

## Example: an agent loop

```ts
export const agent = workflow(async function* (step, event) {
  const store = yield* step.store(AgentStore, {
    id: event.params.agentId,
    initial: { messages: [], status: "idle" },
  });

  let turn = 0;

  while (true) {
    const msg = yield* store.take(
      `next-message:${turn++}`,
      (s) => s.messages.find((m) => !m.processed),
      (draft, m) => {
        draft.messages.find((x) => x.id === m.id)!.processed = true;
      }
    );

    const response = yield* step.run(`llm:${msg.id}`, () =>
      callModel(msg.content)
    );

    yield* store.update(`reply:${msg.id}`, (draft) => {
      draft.messages.push(response);
    });
  }
});
```

Between turns the workflow costs nothing – no process, no timer, no poll. A new message (from another workflow, or [written externally](./store-external.md)) wakes it.

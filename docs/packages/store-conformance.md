# @yieldstar/store-conformance

A Vitest qualification suite for implementations of Yieldstar's `StoreClient` protocol. Connector authors can use it to verify store lifecycle, concurrency, replay idempotency, waiter wake-up, and crash-recovery behavior.

## Install

```sh
pnpm add -D @yieldstar/core @yieldstar/store-conformance vitest
```

## Register the suite

Create a Vitest test file and provide a factory that returns a clean backend:

```ts
import { registerStoreClientConformance } from "@yieldstar/store-conformance";
import { MyStoreClient } from "./my-store-client";

registerStoreClientConformance({
  name: "my-store",
  create(schedulerClient) {
    const backend = createCleanBackend();
    return {
      client: new MyStoreClient({ backend, schedulerClient }),
      dispose: () => backend.close(),
    };
  },
});
```

Run it with either supported test host:

```sh
vitest run store-conformance.test.ts
```

## Optional capabilities

Return `createPeer` when the backend supports multiple clients sharing the same data. This enables the cross-client race suites.

Return `restart` when the backend is durable. This enables crash-recovery suites in addition to the process-local checks.

```ts
create(schedulerClient) {
  const backend = createCleanBackend();
  const client = new MyStoreClient({ backend, schedulerClient });

  return {
    client,
    createPeer: (scheduler) =>
      new MyStoreClient({ backend, schedulerClient: scheduler }),
    restart: async (scheduler) => {
      await client.close();
      return new MyStoreClient({
        backend: backend.reopen(),
        schedulerClient: scheduler,
      });
    },
    dispose: () => backend.close(),
  };
}
```

The normative contract is in the repository's [store connector conformance specification](https://github.com/notationlabs/yieldstar/blob/main/docs/store-connector-spec.md).

# `@yieldstar/store-conformance`

This package contains the runnable qualification suite for YieldStar store connectors. The normative protocol is documented in the [store connector conformance specification](https://github.com/notationlabs/yieldstar/blob/main/docs/store-connector-spec.md).

Install it with the test runner and core package:

```sh
pnpm add -D @yieldstar/core @yieldstar/store-conformance vitest
```

Register the suite from a Vitest test file. The only required integration point is a factory that creates a clean backend and returns its `StoreClient`:

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

The base factory qualifies a process-local connector. A backend that supports multiple clients should also return `createPeer`; a durable backend should additionally return `restart`. These capabilities activate the shared-client race and crash-recovery suites:

```ts
create(schedulerClient) {
  const backend = createCleanBackend();
  const client = new MyStoreClient({ backend, schedulerClient });
  return {
    client,
    createPeer: (scheduler) => new MyStoreClient({ backend, schedulerClient: scheduler }),
    restart: async (scheduler) => {
      await client.close();
      return new MyStoreClient({ backend: backend.reopen(), schedulerClient: scheduler });
    },
    dispose: () => backend.close(),
  };
}
```

Run the test with either supported runtime:

```sh
vitest run store-conformance.test.ts
```

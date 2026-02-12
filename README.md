# YieldStar 🤘

JavaScript‑native distributed workflows.

Write workflows as async generator functions that yield steps. First‑class primitives for retries, delays, and polling. Runs on Bun + SQLite today; Postgres coming next.

## Install

```sh
bun add yieldstar
```

Runtimes and adapters:

- Local execution: `@yieldstar/bun-worker-invoker`, `@yieldstar/bun-sqlite-runtime`
- HTTP server (Bun): `@yieldstar/bun-http-server`, `@yieldstar/bun-worker-invoker`

## Quick Look

Define a workflow that composes steps:

```ts
import { workflow } from "yieldstar";

export const simple = workflow(async function* (step) {
  const n = yield* step.run(() => 1);
  yield* step.delay(1000);
  return yield* step.run(() => n * 2);
});
```

Retries are explicit and structured:

```ts
import { RetryableError } from "yieldstar";

yield* step.run(async () => {
  // e.g. flaky fetch
  throw new RetryableError("temporary", { maxAttempts: 4, retryInterval: 1000 });
});
```

## Learn More

- Full usage, runtimes, APIs, and examples: [packages/yieldstar/README.md](packages/yieldstar/README.md)

## Contributing

- Please open an issue to discuss significant changes before submitting a PR.
- See CONTRIBUTING.md for repo layout, dev workflow, testing, and release details.

## License

MIT

## Author

[Daniel Grant](https://danielgrant.co)

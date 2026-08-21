# Installation

```sh
bun add yieldstar
```

Node projects can install the same package with their package manager:

```sh
pnpm add yieldstar
```

For the resident-process runtime with SQLite persistence:

```sh
bun add @yieldstar/core @yieldstar/worker-invoker @yieldstar/sqlite-runtime pino
```

Import `createSqliteDb` from `@yieldstar/sqlite-runtime/bun` when using Bun or `@yieldstar/sqlite-runtime/node` when using Node 22.6 or newer with TypeScript workers.

To expose that runtime over HTTP, also install:

```sh
bun add @yieldstar/http-server
```

Version 0.5 replaced the old `@yieldstar/bun-sqlite-runtime`, `@yieldstar/bun-worker-invoker`, and `@yieldstar/bun-http-server` packages with the runtime-neutral packages above. Choose the `/bun` or `/node` SQLite connector only when importing `createSqliteDb`.

See the [runtime matrix](../runtimes/index.md) for supported runtime families and connector combinations.

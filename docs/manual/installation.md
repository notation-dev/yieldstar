# Installation

```sh
bun add yieldstar
```

Node projects can install the same package with their package manager:

```sh
pnpm add yieldstar
```

For a local runtime with persistence:

```sh
bun add @yieldstar/worker-invoker @yieldstar/sqlite-runtime
```

Import `createSqliteDb` from `@yieldstar/sqlite-runtime/bun` when using Bun or `@yieldstar/sqlite-runtime/node` when using Node 22.6 or newer with TypeScript workers.

For an HTTP server runtime:

```sh
bun add @yieldstar/http-server @yieldstar/worker-invoker @yieldstar/sqlite-runtime
```

See the [runtime matrix](../runtimes/index.md) for supported runtime families and connector combinations.

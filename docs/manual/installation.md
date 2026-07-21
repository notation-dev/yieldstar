# Installation

```sh
bun add yieldstar
```

For a local runtime with persistence:

```sh
bun add @yieldstar/bun-worker-invoker @yieldstar/sqlite-runtime
```

For an HTTP server runtime:

```sh
bun add @yieldstar/bun-http-server @yieldstar/bun-worker-invoker @yieldstar/sqlite-runtime
```

# Changelog

## Unreleased

## 0.5.0 - 2026-07-21

### Breaking changes

- Renamed `@yieldstar/bun-sqlite-runtime` to `@yieldstar/sqlite-runtime`, `@yieldstar/bun-worker-invoker` to `@yieldstar/worker-invoker`, and `@yieldstar/bun-http-server` to `@yieldstar/http-server`. The old package names are not shipped as compatibility packages; follow the migration guide before upgrading.
- Removed the worker invoker's `executable` option. Parent and worker processes must use the same runtime family because Bun and Node cannot communicate through Node's V8 advanced IPC serialization.
- Store updater callbacks must be synchronous, deterministic, and side-effect-free. `update`, `updateFrom`, and take claims reject promise-returning callbacks because compare-and-swap retries may execute a callback more than once.

### Added

- Added durable workflow stores through `defineStore` and `step.store()`, with `get`, `select`, `update`, `updateFrom`, `deleteFrom`, `when`, and `take` operations.
- Added Standard Schema validation for store state, versioned snapshots and receipts carrying `instanceId` and `version`, and discriminated update and delete results.
- Added compare-and-swap store mutations and an applied-steps ledger so retried workflow store operations have exactly-once semantics, including explicit `already-applied` and `conflict` outcomes.
- Added a minimal synchronous `SqliteDriver` contract and connector entry points at `@yieldstar/sqlite-runtime/bun` and `@yieldstar/sqlite-runtime/node` for real `bun:sqlite` and `node:sqlite` databases.
- Added Node.js support for the resident-process runtime. TypeScript worker entry points require Node 22.6 or newer for built-in type stripping; older Node versions can use compiled JavaScript workers.
- Added one Vitest suite that runs the complete conformance and fork-integration coverage under both Bun and Node.
- Added two-leg GitHub Actions CI pinned to Bun 1.3.14, Node 22.18.0, and pnpm 11.6.0.
- Added a worker `ready` handshake and configurable timeout so missing listeners and unsupported cross-runtime forks fail explicitly instead of hanging.

### Changed

- Made the SQLite heap, scheduler, timers, task queue, event loop, stores, and DAOs independent of a concrete SQLite implementation.
- Replaced `Bun.spawn` worker IPC with `node:child_process.fork`, including propagation of spawn errors and premature child exits. The optional `execPath` can select another binary from the same runtime family; Node must fork Node and Bun must fork Bun.
- Retyped HTTP route handlers with standard `Request` and `Response` APIs while keeping the routes object compatible with `Bun.serve` and other Request-to-Response routers.
- Replaced Bun-specific runtime utilities and targeted all package bundles at Node.
- Replaced `Bun.randomUUIDv7()` with UUID v7 from the `uuid` package.

# Repo guidance

This repository is a TypeScript monorepo set up with:
- **pnpm** for managing workspaces and dependencies
- **Bun** for building and testing code
- **TypeScript** for connecting package types using project references

## Layout

- `packages/` – source for all publishable packages (e.g. `core`, `yieldstar`, `bun-http-server`, etc.)
- `examples/` – small apps and workflow examples
- `test/` – integration tests written using `bun:test`
- Workspace configuration is defined in `pnpm-workspace.yaml`:

```
packages:
  - packages/*
  - examples
  - test
```

## Installing dependencies

Run `pnpm install` in the repo root. This installs all workspace dependencies using the lock file.

## Type checking

To type check all monorepo packages, just run `bun dts`, which also generates type declarations.

## Building the packages

To compile all packages, run `bun run bundle`

This runs each package's `build` script (`bun build`) and then `tsc -b` to generate type declarations.

## Running tests

Execute all tests with Bun's test runner:

```
bun test
```

Tests live in the `test/` folder and import from `bun:test` as shown below:

```ts
import { expect, test, mock } from "bun:test";
```

## Running examples

Example workflows are stored in `examples/workflows/`. The helper script `bun start` currently only imports the chosen file and prints the module – the workflows themselves do
not run automatically. Consider this directory a work in progress.

To inspect an example interactively you can still run:

```
bun start
```

This will prompt you to select a workflow file to import.

## Package structure

The monorepo contains these packages:

- `core` - Base types and runtime abstractions
- `yieldstar` - Main workflow SDK and exports
- `bun-http-server` - HTTP server runtime for Bun
- `bun-postgres-runtime` - PostgreSQL-backed runtime for Bun
- `bun-sqlite-runtime` - SQLite-backed runtime for Bun
- `bun-worker-invoker` - Worker-based step invoker for Bun
- `test-invoker` - Test utilities for step invocation
- `test-runtime` - In-memory runtime for testing
- `test-utils` - Shared testing utilities

## Release process

Releases are handled by `bin/release.sh` which:
- Determines version from git describe
- Publishes scoped packages under `@yieldstar/*` scope
- Publishes the main `yieldstar` package unscoped
- Handles npm account switching between `yieldstar` and `notation` users

Use these commands for releases:
- `bun run bump` - Bump version with alpha pre-release
- `bun run prerelease` - Install deps and bundle before release
- `bun run release` - Execute the release script

## Postgres test database

Currently postgres test credentials are hard coded.

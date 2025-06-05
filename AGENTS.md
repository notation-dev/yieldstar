# Repo guidance for Codex

This repository is a TypeScript monorepo managed with **pnpm** and built/tested with **Bun**.

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

## Building the packages
Compile every package with the `bundle` script from the root `package.json`:

```
bun run bundle
```

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
Example workflows are stored in `examples/workflows/`. The helper script `bun start`
currently only imports the chosen file and prints the module – the workflows themselves do
not run automatically. Consider this directory a work in progress.

To inspect an example interactively you can still run:

```
bun start
```

This will prompt you to select a workflow file to import.

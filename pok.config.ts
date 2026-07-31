import { defineConfig } from "@pokit/core";
import { createTerminalUI } from "@pokit/terminal";
import { docs, release } from "pok-plugins";
import type { ReleasePackage } from "pok-plugins";

// The old release flow built everything (`bun --filter '*' build`) and then
// emitted declarations with `tsc -b`; every package shares that command so the
// plugin runs it once.
const build = "bun --filter '*' build && tsc -b";

// @yieldstar/* publishes from the `yieldstar` npm account.
const scoped: ReleasePackage[] = [
  { file: "packages/core/package.json", build },
  { file: "packages/http-server/package.json", build },
  { file: "packages/sqlite-runtime/package.json", build },
  { file: "packages/store-conformance/package.json", build },
  { file: "packages/worker-invoker/package.json", build },
];

// The unscoped `yieldstar` package publishes from the `notation` npm account.
const cli: ReleasePackage[] = [{ file: "packages/yieldstar/package.json", build }];

// Version-bumped in lockstep but never published.
const internal: ReleasePackage[] = [
  { file: "package.json", publish: false },
  { file: "packages/test-invoker/package.json", publish: false },
  { file: "packages/test-runtime/package.json", publish: false },
  { file: "packages/test-utils/package.json", publish: false },
];

export default defineConfig({
  commandsDir: "./commands",
  ...createTerminalUI(),
  appName: "yieldstar",
  plugins: [
    docs({ name: "yieldstar-docs" }),
    release({
      preid: "alpha",
      packages: {
        // `pok version --packages all` bumps every manifest in lockstep; the
        // scoped/cli groups exist so each can publish under its npm account.
        all: { label: "Everything (version bumps + publish)", packages: [...scoped, ...cli, ...internal] },
        scoped: { label: "@yieldstar/* (yieldstar npm account)", packages: scoped },
        cli: { label: "yieldstar CLI (notation npm account)", packages: cli },
      },
    }),
  ],
});

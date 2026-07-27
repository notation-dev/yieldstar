import { defineConfig } from "@pokit/core";
import { createTerminalUI } from "@pokit/terminal";

export default defineConfig({
  commandsDir: "./commands",
  ...createTerminalUI(),
  appName: "yieldstar",
  // The existing npm scripts stay the machine-facing contract — CI calls
  // `bun run bundle` and `pnpm run test:*` directly — so pok surfaces them
  // rather than reimplementing them in a second place. Commands in
  // ./commands cover what has no script equivalent.
  pmScripts: ["bundle", "dts", "dev", "test", "test:node", "test:bun", "start", "bump"],
});

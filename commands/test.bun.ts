import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Run tests under Bun",
  run: async (r) => {
    await r.exec("bun --bun ./node_modules/vitest/vitest.mjs run");
  },
});

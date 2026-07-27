import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Run tests under Node",
  run: async (r) => {
    await r.exec("node ./node_modules/vitest/vitest.mjs run");
  },
});

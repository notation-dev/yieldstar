import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Run the example workflow",
  run: async (r) => {
    await r.exec("bun scripts/run-example.ts");
  },
});

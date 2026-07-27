import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Bump package versions",
  run: async (r) => {
    await r.exec("bunx bumpp --preid alpha -r");
  },
});

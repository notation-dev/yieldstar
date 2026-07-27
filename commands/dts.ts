import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Build type declarations",
  run: async (r) => {
    await r.exec("tsc -b");
  },
});

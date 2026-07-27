import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Dry-run a release",
  run: async (r) => {
    await r.exec("bin/release.sh --dry-run");
  },
});

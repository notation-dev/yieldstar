import { defineCommand } from "@pokit/core";

// `pok test all` runs every suite; the children run one runtime at a time.
export const command = defineCommand({
  label: "Run tests",
  enableRunAllChildren: "sequential",
});

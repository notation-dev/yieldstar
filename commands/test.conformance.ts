import { defineCommand } from "@pokit/core";

export const command = defineCommand({
  label: "Smoke test the store conformance package",
  run: async (r) => {
    await r.exec("bun scripts/smoke-store-conformance-package.ts");
  },
});

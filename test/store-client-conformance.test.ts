import {
  registerStoreClientConformance,
  sqliteConformance,
} from "./store-client-conformance";

const isBun = "Bun" in globalThis;
const { createSqliteDb } = isBun
  ? await import("@yieldstar/sqlite-runtime/bun")
  : await import("@yieldstar/sqlite-runtime/node");

registerStoreClientConformance({
  ...sqliteConformance(isBun ? "sqlite-bun" : "sqlite-node", () =>
    createSqliteDb({ path: ":memory:", wal: false })
  ),
});

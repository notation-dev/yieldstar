import { describe, expect, spyOn, test } from "bun:test";
import * as core from "@yieldstar/core";
import { createSqliteDb } from "@yieldstar/sqlite-runtime/bun";
import {
  registerStoreClientConformance,
  sqliteConformance,
} from "./store-client-conformance";

registerStoreClientConformance({
  api: {
    describe,
    test,
    expect,
    spyOn,
    spyOnDiffStorePaths: () => spyOn(core, "diffStorePaths"),
  },
  ...sqliteConformance("sqlite-bun", () =>
    createSqliteDb({ path: ":memory:", wal: false })
  ),
});

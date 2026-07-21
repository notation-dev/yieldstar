import { describe, mock, test } from "node:test";
import { expect } from "expect";
import { createSqliteDb } from "@yieldstar/sqlite-runtime/node";
import {
  registerStoreClientConformance,
  sqliteConformance,
} from "./store-client-conformance.ts";

registerStoreClientConformance({
  api: { describe, test, expect, spyOn },
  ...sqliteConformance("sqlite-node", () =>
    createSqliteDb({ path: ":memory:", wal: false })
  ),
});

function spyOn(target, property) {
  return {
    mockImplementation(implementation) {
      const tracker = mock.method(target, property, implementation);
      return {
        mockRestore() {
          tracker.mock.restore();
        },
      };
    },
  };
}

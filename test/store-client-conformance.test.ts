import { registerStoreClientConformance } from "@yieldstar/store-conformance";
import type { SchedulerClient } from "@yieldstar/core";
import { MemoryStoreClient } from "@yieldstar/test-runtime";
import { SqliteStoreClient } from "@yieldstar/sqlite-runtime";

const isBun = "Bun" in globalThis;
const { createSqliteDb } = isBun
  ? await import("@yieldstar/sqlite-runtime/bun")
  : await import("@yieldstar/sqlite-runtime/node");

registerStoreClientConformance({
  name: "memory",
  create(schedulerClient) {
    return { client: new MemoryStoreClient({ schedulerClient }) };
  },
});

registerStoreClientConformance({
  name: isBun ? "sqlite-bun" : "sqlite-node",
  create(schedulerClient: SchedulerClient) {
    const db = createSqliteDb({ path: ":memory:", wal: false });
    return {
      client: new SqliteStoreClient({ db, schedulerClient }),
      createPeer(peerScheduler: SchedulerClient) {
        return new SqliteStoreClient({ db, schedulerClient: peerScheduler });
      },
      restart(restartScheduler: SchedulerClient) {
        return new SqliteStoreClient({ db, schedulerClient: restartScheduler });
      },
      dispose() {
        db.close();
      },
    };
  },
});

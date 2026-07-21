import { Database } from "bun:sqlite";
import { SqliteStoreClient } from "../packages/bun-sqlite-runtime/src/sqlite-store";
import { MemoryStoreClient } from "../packages/test-runtime/src/memory-store";
import type {
  DurableStoreClientTarget,
  SharedStoreClientTarget,
  StoreClientTarget,
} from "./store-client-conformance-utils";

export const memoryStoreTarget: StoreClientTarget = {
  name: "memory",
  create(schedulerClient) {
    return {
      client: new MemoryStoreClient({ schedulerClient }),
      dispose() {},
    };
  },
};

export const sqliteStoreTarget: StoreClientTarget = {
  name: "sqlite",
  create(schedulerClient) {
    const db = new Database(":memory:");
    return {
      client: new SqliteStoreClient({ db, schedulerClient }),
      dispose() {
        db.close();
      },
    };
  },
};

export const sharedSqliteStoreTarget: SharedStoreClientTarget = {
  name: "sqlite",
  create([firstScheduler, secondScheduler]) {
    const db = new Database(":memory:");
    return {
      clients: [
        new SqliteStoreClient({ db, schedulerClient: firstScheduler }),
        new SqliteStoreClient({ db, schedulerClient: secondScheduler }),
      ],
      dispose() {
        db.close();
      },
    };
  },
};

export const durableSqliteStoreTarget: DurableStoreClientTarget = {
  name: "sqlite",
  create(schedulerClient) {
    const db = new Database(":memory:");
    return {
      client: new SqliteStoreClient({ db, schedulerClient }),
      restart(nextSchedulerClient) {
        return new SqliteStoreClient({ db, schedulerClient: nextSchedulerClient });
      },
      dispose() {
        db.close();
      },
    };
  },
};

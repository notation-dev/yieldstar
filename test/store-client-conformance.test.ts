import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { defineStore, type StandardSchemaV1 } from "@yieldstar/core";
import { SqliteStoreClient } from "../packages/bun-sqlite-runtime/src/sqlite-store";
import { MemoryStoreClient } from "../packages/test-runtime/src/memory-store";
import {
  defineDurableWakeConformance,
  defineSharedBackendConformance,
  defineStoreClientConformance,
  defineWakeDeliveryConformance,
  type DurableStoreClientTarget,
  type SharedStoreClientTarget,
  type StoreClientTarget,
} from "./store-client-conformance";

const memory: StoreClientTarget = {
  name: "memory",
  create(schedulerClient) {
    return {
      client: new MemoryStoreClient({ schedulerClient }),
      dispose() {},
    };
  },
};

const sqlite: StoreClientTarget = {
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

const sharedSqlite: SharedStoreClientTarget = {
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

const durableSqlite: DurableStoreClientTarget = {
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

defineStoreClientConformance(memory);
defineWakeDeliveryConformance(memory);

defineStoreClientConformance(sqlite);
defineWakeDeliveryConformance(sqlite);
defineSharedBackendConformance(sharedSqlite);
defineDurableWakeConformance(durableSqlite);

test("memory store retries an updater after a commit conflict", async () => {
  type State = { messages: string[] };
  const Store = defineStore("memory-cas-retry", schema<State>());
  const client = new MemoryStoreClient({ schedulerClient: { async requestWakeUp() {} } });
  let updaterRuns = 0;

  await client.getOrCreateStore({
    definition: Store,
    id: "race",
    initial: { messages: [] },
  });
  await Promise.all([
    client.updateStore({
      definition: Store,
      id: "race",
      updater(draft) {
        updaterRuns++;
        draft.messages.push("a");
      },
    }),
    client.updateStore({
      definition: Store,
      id: "race",
      updater(draft) {
        updaterRuns++;
        draft.messages.push("b");
      },
    }),
  ]);

  expect(updaterRuns).toBe(3);
});

function schema<T>(): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "conformance",
      validate(value) {
        return { value: value as T };
      },
    },
  };
}

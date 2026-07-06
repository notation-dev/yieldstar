import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  defineStore,
  type SchedulerClient,
  type StandardSchemaV1,
  type WorkflowEvent,
} from "@yieldstar/core";
import { SqliteStoreClient } from "./sqlite-store";

type State = {
  messages: { id: string }[];
};

const Store = defineStore("sqlite-test", schema<State>());

test("sqlite store updates wake matching waiters", async () => {
  const db = new Database(":memory:");
  const events: WorkflowEvent[] = [];
  const schedulerClient: SchedulerClient = {
    async requestWakeUp(event) {
      events.push(event);
    },
  };
  const client = new SqliteStoreClient({ db, schedulerClient });
  const event = {
    workflowId: "workflow",
    executionId: "execution",
    params: undefined,
    context: new Map(),
  };

  await client.getOrCreateStore({
    definition: Store,
    id: "one",
    initial: { messages: [] },
  });
  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "one",
    sinceVersion: 0,
    readPaths: [["messages"]],
  });
  await client.updateStore({
    definition: Store,
    id: "one",
    updater(draft) {
      draft.messages.push({ id: "msg-1" });
    },
  });

  expect(events).toEqual([event]);
});

test("registering a waiter with a stale sinceVersion triggers an immediate wake", async () => {
  const db = new Database(":memory:");
  const events: WorkflowEvent[] = [];
  const schedulerClient: SchedulerClient = {
    async requestWakeUp(event) {
      events.push(event);
    },
  };
  const client = new SqliteStoreClient({ db, schedulerClient });
  const event = {
    workflowId: "workflow",
    executionId: "execution",
    params: undefined,
    context: new Map(),
  };

  await client.getOrCreateStore({
    definition: Store,
    id: "stale",
    initial: { messages: [] },
  });

  // Simulate an update landing between getStore and registerWaiter
  await client.updateStore({
    definition: Store,
    id: "stale",
    updater(draft) {
      draft.messages.push({ id: "msg-1" });
    },
  });

  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "stale",
    sinceVersion: 0,
    readPaths: [["messages"]],
  });

  expect(events).toEqual([event]);

  // The waiter must not linger and double-fire on the next write
  events.length = 0;
  await client.updateStore({
    definition: Store,
    id: "stale",
    updater(draft) {
      draft.messages.push({ id: "msg-2" });
    },
  });
  expect(events).toEqual([]);
});

test("concurrent async updaters on one client both commit", async () => {
  const db = new Database(":memory:");
  const schedulerClient: SchedulerClient = {
    async requestWakeUp() {},
  };
  const client = new SqliteStoreClient({ db, schedulerClient });

  await client.getOrCreateStore({
    definition: Store,
    id: "race",
    initial: { messages: [] },
  });

  const [first, second] = await Promise.all([
    client.updateStore({
      definition: Store,
      id: "race",
      async updater(draft) {
        await Promise.resolve();
        draft.messages.push({ id: "msg-a" });
      },
    }),
    client.updateStore({
      definition: Store,
      id: "race",
      async updater(draft) {
        await Promise.resolve();
        draft.messages.push({ id: "msg-b" });
      },
    }),
  ]);

  expect([first.version, second.version].sort()).toEqual([1, 2]);

  const snapshot = await client.getStore({ definition: Store, id: "race" });
  expect(snapshot.version).toBe(2);
  expect(snapshot.state.messages).toEqual([{ id: "msg-a" }, { id: "msg-b" }]);
});

type TakeState = {
  messages: { id: string; claimedBy?: string }[];
};

const TakeStore = defineStore("sqlite-take-test", schema<TakeState>());

function createTakeClient() {
  const db = new Database(":memory:");
  const events: WorkflowEvent[] = [];
  const schedulerClient: SchedulerClient = {
    async requestWakeUp(event) {
      events.push(event);
    },
  };
  return { client: new SqliteStoreClient({ db, schedulerClient }), events };
}

const takeEvent = {
  workflowId: "workflow",
  executionId: "execution",
  params: undefined,
  context: new Map(),
};

test("concurrent takers claim distinct items", async () => {
  const { client } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "take-race",
    initial: { messages: [{ id: "msg-1" }, { id: "msg-2" }] },
  });

  const takeAs = (executionId: string) =>
    client.takeFromStore({
      definition: TakeStore,
      id: "take-race",
      selector: (s) => s.messages.find((m) => !m.claimedBy),
      claim: (draft, msg) => {
        msg.claimedBy = executionId;
      },
    });

  const [first, second] = await Promise.all([takeAs("a"), takeAs("b")]);

  if (!first.matched || !second.matched) {
    throw new Error("both takes should match");
  }
  expect(first.selected.id).not.toBe(second.selected.id);
  expect(first.selected.claimedBy).toBe("a");
  expect(second.selected.claimedBy).toBe("b");
  expect([first.version, second.version].sort()).toEqual([1, 2]);

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "take-race",
  });
  expect(snapshot.state.messages.map((m) => m.claimedBy).sort()).toEqual([
    "a",
    "b",
  ]);
});

test("take returns readPaths and version when the selector misses", async () => {
  const { client } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "take-miss",
    initial: { messages: [] },
  });

  const outcome = await client.takeFromStore({
    definition: TakeStore,
    id: "take-miss",
    selector: (s) => s.messages.find((m) => !m.claimedBy),
    claim: (draft, msg) => {
      msg.claimedBy = "x";
    },
  });

  expect(outcome.matched).toBe(false);
  if (outcome.matched) throw new Error("unreachable");
  expect(outcome.version).toBe(0);
  expect(outcome.readPaths).toContainEqual(["messages"]);

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "take-miss",
  });
  expect(snapshot.version).toBe(0);
});

test("a successful take wakes matching waiters", async () => {
  const { client, events } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "take-wake",
    initial: { messages: [{ id: "msg-1" }] },
  });
  await client.registerWaiter({
    workflowId: takeEvent.workflowId,
    executionId: takeEvent.executionId,
    stepKey: "watch-messages",
    event: takeEvent,
    storeName: TakeStore.name,
    storeId: "take-wake",
    sinceVersion: 0,
    readPaths: [["messages"]],
  });

  await client.takeFromStore({
    definition: TakeStore,
    id: "take-wake",
    selector: (s) => s.messages.find((m) => !m.claimedBy),
    claim: (draft, msg) => {
      msg.claimedBy = "worker";
    },
  });

  expect(events).toEqual([takeEvent]);
});

test("take rejects async claims without committing", async () => {
  const { client } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "take-async",
    initial: { messages: [{ id: "msg-1" }] },
  });

  await expect(
    client.takeFromStore({
      definition: TakeStore,
      id: "take-async",
      selector: (s) => s.messages.find((m) => !m.claimedBy),
      claim: (async (draft: any, msg: any) => {
        msg.claimedBy = "worker";
      }) as any,
    })
  ).rejects.toThrow(/synchronous/);

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "take-async",
  });
  expect(snapshot.version).toBe(0);
  expect(snapshot.state.messages[0]!.claimedBy).toBeUndefined();
});

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "yieldstar-test",
      validate(value) {
        return { value: value as T };
      },
    },
  };
}

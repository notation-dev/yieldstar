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

  const initial = await client.getOrCreateStore({
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
    instanceId: initial.instanceId,
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

test("retry delivers a wake whose first enqueue failed after the store commit", async () => {
  const db = new Database(":memory:");
  const events: WorkflowEvent[] = [];
  let wakeAttempts = 0;
  const schedulerClient: SchedulerClient = {
    async requestWakeUp(event) {
      wakeAttempts += 1;
      if (wakeAttempts === 1) throw new Error("wake enqueue failed");
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

  const initial = await client.getOrCreateStore({
    definition: Store,
    id: "wake-enqueue-retry",
    initial: { messages: [] },
  });
  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "wake-enqueue-retry",
    instanceId: initial.instanceId,
    sinceVersion: initial.version,
    readPaths: [["messages"]],
  });

  const update = () =>
    client.updateStore({
      definition: Store,
      id: "wake-enqueue-retry",
      updater(draft) {
        draft.messages.push({ id: "msg-1" });
      },
      stepId: { executionId: "updater", stepKey: "append-message" },
    });

  await expect(update()).rejects.toThrow("wake enqueue failed");
  await update();

  expect(wakeAttempts).toBe(2);
  expect(events).toEqual([event]);
  expect(
    await client.getStore({
      definition: Store,
      id: "wake-enqueue-retry",
    })
  ).toMatchObject({
    state: { messages: [{ id: "msg-1" }] },
    version: 1,
  });
});

test("a new sqlite store client recovers a committed wake after interruption", async () => {
  const db = new Database(":memory:");
  const interruptedClient = new SqliteStoreClient({
    db,
    schedulerClient: {
      async requestWakeUp() {
        throw new Error("process interrupted before wake enqueue");
      },
    },
  });
  const event = {
    workflowId: "workflow",
    executionId: "execution",
    params: undefined,
    context: new Map(),
  };

  const initial = await interruptedClient.getOrCreateStore({
    definition: Store,
    id: "wake-recovery",
    initial: { messages: [] },
  });
  await interruptedClient.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "wake-recovery",
    instanceId: initial.instanceId,
    sinceVersion: initial.version,
    readPaths: [["messages"]],
  });

  await expect(
    interruptedClient.updateStore({
      definition: Store,
      id: "wake-recovery",
      updater(draft) {
        draft.messages.push({ id: "msg-1" });
      },
      stepId: { executionId: "updater", stepKey: "append-message" },
    })
  ).rejects.toThrow("process interrupted before wake enqueue");

  const recoveredEvents: WorkflowEvent[] = [];
  new SqliteStoreClient({
    db,
    schedulerClient: {
      async requestWakeUp(recoveredEvent) {
        recoveredEvents.push(recoveredEvent);
      },
    },
  });
  await Bun.sleep(0);

  expect(recoveredEvents).toEqual([event]);
});

test("wake delivery does not delete a waiter re-registered by another client", async () => {
  const db = new Database(":memory:");
  const event = {
    workflowId: "workflow",
    executionId: "execution",
    params: undefined,
    context: new Map(),
  };
  let secondClient: SqliteStoreClient;
  let wakeCount = 0;
  const firstClient = new SqliteStoreClient({
    db,
    schedulerClient: {
      async requestWakeUp() {
        wakeCount++;
        if (wakeCount === 1) {
          const current = await secondClient.getStore({
            definition: Store,
            id: "re-register",
          });
          await secondClient.registerWaiter({
            workflowId: event.workflowId,
            executionId: event.executionId,
            stepKey: "next-message",
            event,
            storeName: Store.name,
            storeId: "re-register",
            instanceId: current.instanceId,
            sinceVersion: current.version,
            readPaths: [["messages"]],
          });
        }
      },
    },
  });
  secondClient = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });

  const initial = await firstClient.getOrCreateStore({
    definition: Store,
    id: "re-register",
    initial: { messages: [] },
  });
  await firstClient.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "re-register",
    instanceId: initial.instanceId,
    sinceVersion: initial.version,
    readPaths: [["messages"]],
  });

  for (const id of ["msg-1", "msg-2"]) {
    await firstClient.updateStore({
      definition: Store,
      id: "re-register",
      updater(draft) {
        draft.messages.push({ id });
      },
    });
  }

  expect(wakeCount).toBe(2);
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

  const initial = await client.getOrCreateStore({
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
    instanceId: initial.instanceId,
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

test("concurrent synchronous updates on one client both commit", async () => {
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
      updater(draft) {
        draft.messages.push({ id: "msg-a" });
      },
    }),
    client.updateStore({
      definition: Store,
      id: "race",
      updater(draft) {
        draft.messages.push({ id: "msg-b" });
      },
    }),
  ]);

  expect([first.version, second.version].sort()).toEqual([1, 2]);

  const snapshot = await client.getStore({ definition: Store, id: "race" });
  expect(snapshot.version).toBe(2);
  expect(snapshot.state.messages).toEqual([{ id: "msg-a" }, { id: "msg-b" }]);
});

test("async updaters are rejected without committing", async () => {
  const db = new Database(":memory:");
  const client = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });
  await client.getOrCreateStore({
    definition: Store,
    id: "async-updater",
    initial: { messages: [] },
  });

  await expect(
    client.updateStore({
      definition: Store,
      id: "async-updater",
      updater: (async (draft: State) => {
        draft.messages.push({ id: "never-committed" });
      }) as any,
    })
  ).rejects.toThrow("Store updaters must be synchronous");

  expect(
    await client.getStore({ definition: Store, id: "async-updater" })
  ).toMatchObject({ state: { messages: [] }, version: 0 });
});

test("updateStoreFrom commits only from the supplied snapshot and replays ledger-first", async () => {
  const db = new Database(":memory:");
  const client = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });
  const snapshot = await client.getOrCreateStore({
    definition: Store,
    id: "conditional",
    initial: { messages: [] },
  });
  let updaterRuns = 0;
  const stepId = { executionId: "execution", stepKey: "conditional-update" };

  const committed = await client.updateStoreFrom({
    definition: Store,
    id: "conditional",
    snapshot,
    stepId,
    updater(draft) {
      updaterRuns++;
      draft.messages.push({ id: "msg-1" });
    },
  });
  expect(committed).toEqual({
    updated: true,
    state: { messages: [{ id: "msg-1" }] },
    previousVersion: 0,
    version: 1,
  });

  await client.updateStore({
    definition: Store,
    id: "conditional",
    updater(draft) {
      draft.messages.push({ id: "msg-2" });
    },
  });

  const replayed = await client.updateStoreFrom({
    definition: Store,
    id: "conditional",
    snapshot: { ...snapshot, instanceId: "" },
    stepId,
    updater() {
      updaterRuns++;
    },
  });
  expect(replayed).toEqual(committed);

  const conflicted = await client.updateStoreFrom({
    definition: Store,
    id: "conditional",
    snapshot,
    updater() {
      updaterRuns++;
    },
  });
  expect(conflicted).toEqual({
    updated: false,
    expectedInstanceId: snapshot.instanceId,
    actualInstanceId: snapshot.instanceId,
    expectedVersion: 0,
    actualVersion: 2,
  });

  await expect(
    client.updateStoreFrom({
      definition: Store,
      id: "conditional",
      snapshot: { ...snapshot, instanceId: "" },
      updater() {
        updaterRuns++;
      },
    })
  ).rejects.toThrow("Store snapshot is missing instanceId");
  expect(updaterRuns).toBe(1);
});

test("updateStoreFrom normalizes legacy applied-step receipts", async () => {
  const db = new Database(":memory:");
  const client = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });
  const snapshot = await client.getOrCreateStore({
    definition: Store,
    id: "legacy-receipt",
    initial: { messages: [] },
  });
  const result = {
    state: { messages: [{ id: "msg-1" }] },
    previousVersion: 0,
    version: 1,
  };
  db.query(
    `INSERT INTO store_applied_steps
       (store_name, store_id, execution_id, step_key, result)
     VALUES (?, ?, ?, ?, ?)`
  ).run(Store.name, "legacy-receipt", "execution", "update", JSON.stringify(result));

  expect(
    await client.updateStoreFrom({
      definition: Store,
      id: "legacy-receipt",
      snapshot,
      stepId: { executionId: "execution", stepKey: "update" },
      updater() {
        throw new Error("legacy receipt should win before updater execution");
      },
    })
  ).toEqual({ updated: true, ...result });
});

test("listStores and deleteStore manage logical store instances", async () => {
  const db = new Database(":memory:");
  const client = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });
  const OtherStore = defineStore("sqlite-test-other", schema<State>());
  const first = await client.getOrCreateStore({
    definition: Store,
    id: "b",
    initial: { messages: [] },
  });
  const second = await client.getOrCreateStore({
    definition: Store,
    id: "a",
    initial: { messages: [] },
  });
  await client.getOrCreateStore({
    definition: OtherStore,
    id: "a",
    initial: { messages: [] },
  });

  expect(first.instanceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  expect(second.instanceId > first.instanceId).toBe(true);
  expect(await client.listStores(Store)).toEqual(["a", "b"]);

  await client.deleteStore({ definition: Store, id: "b" });
  expect(await client.listStores(Store)).toEqual(["a"]);
  expect(client.getStore({ definition: Store, id: "b" })).rejects.toThrow(
    'Store "sqlite-test:b" does not exist'
  );
  await client.deleteStore({ definition: Store, id: "missing" });
});

test("deleteStoreFrom guards recreated stores and records the ledger first", async () => {
  const db = new Database(":memory:");
  const client = new SqliteStoreClient({
    db,
    schedulerClient: { async requestWakeUp() {} },
  });
  const original = await client.getOrCreateStore({
    definition: Store,
    id: "delete-from",
    initial: { messages: [] },
  });
  await client.updateStore({
    definition: Store,
    id: "delete-from",
    updater(draft) {
      draft.messages.push({ id: "changed" });
    },
  });

  const versionConflict = await client.deleteStoreFrom({
    definition: Store,
    id: "delete-from",
    snapshot: original,
  });
  expect(versionConflict).toMatchObject({
    deleted: false,
    reason: "conflict",
    expectedInstanceId: original.instanceId,
    actualInstanceId: original.instanceId,
    expectedVersion: 0,
    actualVersion: 1,
  });

  const current = await client.getStore({
    definition: Store,
    id: "delete-from",
  });
  const stepId = { executionId: "execution", stepKey: "delete" };
  expect(
    await client.deleteStoreFrom({
      definition: Store,
      id: "delete-from",
      snapshot: current,
      stepId,
    })
  ).toEqual({ deleted: true });

  expect(
    await client.deleteStoreFrom({
      definition: Store,
      id: "delete-from",
      snapshot: current,
    })
  ).toEqual({
    deleted: false,
    reason: "not-found",
    expectedInstanceId: current.instanceId,
    expectedVersion: current.version,
  });

  const recreated = await client.getOrCreateStore({
    definition: Store,
    id: "delete-from",
    initial: { messages: [] },
  });
  expect(recreated.instanceId).not.toBe(original.instanceId);
  expect(recreated.version).toBe(0);

  expect(
    await client.deleteStoreFrom({
      definition: Store,
      id: "delete-from",
      snapshot: current,
      stepId,
    })
  ).toEqual({ deleted: true });
  expect(
    await client.getStore({ definition: Store, id: "delete-from" })
  ).toEqual(recreated);

  const staleUpdate = await client.updateStoreFrom({
    definition: Store,
    id: "delete-from",
    snapshot: original,
    updater() {},
  });
  expect(staleUpdate).toMatchObject({
    updated: false,
    expectedInstanceId: original.instanceId,
    actualInstanceId: recreated.instanceId,
    expectedVersion: 0,
    actualVersion: 0,
  });
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

  const initial = await client.getOrCreateStore({
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

  const initial = await client.getOrCreateStore({
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
    instanceId: initial.instanceId,
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

  const initial = await client.getOrCreateStore({
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

test("updateStore with a stepId is exactly-once: the ledger replays the recorded result", async () => {
  const { client } = createTakeClient();
  const stepId = { executionId: "exec-1", stepKey: "append-once" };

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "ledger-update",
    initial: { messages: [] },
  });

  let updaterRuns = 0;
  const updateOnce = () =>
    client.updateStore({
      definition: TakeStore,
      id: "ledger-update",
      updater(draft) {
        updaterRuns++;
        draft.messages.push({ id: "msg-1" });
      },
      stepId,
    });

  const first = await updateOnce();
  // Simulates a crash between store commit and heap write: replay
  // cache-misses and re-issues the same update with the same stepId
  const second = await updateOnce();

  expect(updaterRuns).toBe(1);
  expect(second).toEqual(first);
  expect(first.previousVersion).toBe(0);
  expect(first.version).toBe(1);

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "ledger-update",
  });
  // Version bumped exactly once
  expect(snapshot.version).toBe(1);
  expect(snapshot.state.messages).toEqual([{ id: "msg-1" }]);
});

test("updateStore without a stepId never consults the ledger", async () => {
  const { client } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "ledger-external",
    initial: { messages: [] },
  });

  let updaterRuns = 0;
  const updateOnce = () =>
    client.updateStore({
      definition: TakeStore,
      id: "ledger-external",
      updater(draft) {
        updaterRuns++;
        draft.messages.push({ id: `msg-${updaterRuns}` });
      },
    });

  await updateOnce();
  await updateOnce();

  expect(updaterRuns).toBe(2);
  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "ledger-external",
  });
  expect(snapshot.version).toBe(2);
  expect(snapshot.state.messages).toHaveLength(2);
});

test("takeFromStore with a stepId is exactly-once for matched takes", async () => {
  const { client } = createTakeClient();
  const stepId = { executionId: "exec-1", stepKey: "take-once" };

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "ledger-take",
    initial: { messages: [{ id: "msg-1" }, { id: "msg-2" }] },
  });

  let selectorRuns = 0;
  let claimRuns = 0;
  const takeOnce = () =>
    client.takeFromStore({
      definition: TakeStore,
      id: "ledger-take",
      selector: (s) => {
        selectorRuns++;
        return s.messages.find((m) => !m.claimedBy);
      },
      claim: (draft, msg) => {
        claimRuns++;
        msg.claimedBy = "exec-1";
      },
      stepId,
    });

  const first = await takeOnce();
  // Replay after a crash between store commit and heap write
  const second = await takeOnce();

  expect(selectorRuns).toBe(1);
  expect(claimRuns).toBe(1);
  expect(second).toEqual(first);
  if (!first.matched || !second.matched) throw new Error("takes must match");
  // The recorded outcome replays verbatim – NOT a re-claim of msg-2
  expect(second.selected).toEqual({ id: "msg-1", claimedBy: "exec-1" });
  expect(second.version).toBe(1);

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "ledger-take",
  });
  expect(snapshot.version).toBe(1);
  expect(snapshot.state.messages).toEqual([
    { id: "msg-1", claimedBy: "exec-1" },
    { id: "msg-2" },
  ]);
});

test("unmatched takes are not recorded in the ledger and re-evaluate", async () => {
  const { client } = createTakeClient();
  const stepId = { executionId: "exec-1", stepKey: "take-when-ready" };

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "ledger-take-miss",
    initial: { messages: [] },
  });

  const takeOnce = () =>
    client.takeFromStore({
      definition: TakeStore,
      id: "ledger-take-miss",
      selector: (s) => s.messages.find((m) => !m.claimedBy),
      claim: (draft, msg) => {
        msg.claimedBy = "exec-1";
      },
      stepId,
    });

  const miss = await takeOnce();
  expect(miss.matched).toBe(false);

  // The unmatched outcome must NOT be replayed from the ledger – after the
  // store gains a message, the same step must be able to claim it
  await client.updateStore({
    definition: TakeStore,
    id: "ledger-take-miss",
    updater(draft) {
      draft.messages.push({ id: "msg-1" });
    },
  });

  const hit = await takeOnce();
  expect(hit.matched).toBe(true);
  if (!hit.matched) throw new Error("unreachable");
  expect(hit.selected).toEqual({ id: "msg-1", claimedBy: "exec-1" });

  // ...and once matched, the outcome IS recorded
  const replay = await takeOnce();
  expect(replay).toEqual(hit);
});

test("ledger entries are scoped per execution and step key", async () => {
  const { client } = createTakeClient();

  await client.getOrCreateStore({
    definition: TakeStore,
    id: "ledger-scope",
    initial: { messages: [] },
  });

  const updateAs = (executionId: string, stepKey: string) =>
    client.updateStore({
      definition: TakeStore,
      id: "ledger-scope",
      updater(draft) {
        draft.messages.push({ id: `${executionId}:${stepKey}` });
      },
      stepId: { executionId, stepKey },
    });

  await updateAs("exec-1", "step-a");
  await updateAs("exec-1", "step-b");
  await updateAs("exec-2", "step-a");

  const snapshot = await client.getStore({
    definition: TakeStore,
    id: "ledger-scope",
  });
  expect(snapshot.version).toBe(3);
  expect(snapshot.state.messages.map((m) => m.id)).toEqual([
    "exec-1:step-a",
    "exec-1:step-b",
    "exec-2:step-a",
  ]);
});

test("an updater that returns a replacement state wakes waiters via the diff fallback", async () => {
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

  const initial = await client.getOrCreateStore({
    definition: Store,
    id: "replace",
    initial: { messages: [] },
  });
  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "replace",
    instanceId: initial.instanceId,
    sinceVersion: 0,
    readPaths: [["messages"]],
  });

  // Returns a fresh state instead of mutating the draft – no writes go
  // through the recording proxy, so the client falls back to diffing.
  await client.updateStore({
    definition: Store,
    id: "replace",
    updater: () => ({ messages: [{ id: "msg-1" }] }),
  });

  expect(events).toEqual([event]);
  const snapshot = await client.getStore({ definition: Store, id: "replace" });
  expect(snapshot.state).toEqual({ messages: [{ id: "msg-1" }] });
});

test("committed state is proxy-free and structuredClone-able", async () => {
  const db = new Database(":memory:");
  const schedulerClient: SchedulerClient = {
    async requestWakeUp() {},
  };
  const client = new SqliteStoreClient({ db, schedulerClient });

  const initial = await client.getOrCreateStore({
    definition: Store,
    id: "laundered",
    initial: { messages: [{ id: "msg-1" }] },
  });

  // Read a child through the recording proxy and store it elsewhere in the
  // draft – the committed state must contain no proxy wrappers.
  const result = await client.updateStore({
    definition: Store,
    id: "laundered",
    updater(draft) {
      (draft as Record<string, unknown>).lastMessage = draft.messages[0];
      (draft as Record<string, unknown>).wrapped = { inner: draft.messages };
    },
  });

  expect(() => structuredClone(result.state)).not.toThrow();

  const snapshot = await client.getStore({
    definition: Store,
    id: "laundered",
  });
  expect(() => structuredClone(snapshot.state)).not.toThrow();
  expect((snapshot.state as Record<string, unknown>).lastMessage).toEqual({
    id: "msg-1",
  });
  expect((snapshot.state as Record<string, unknown>).wrapped).toEqual({
    inner: [{ id: "msg-1" }],
  });
});

test("a take claim's mutations are recorded and wake matching waiters", async () => {
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

  type TakeState = { messages: { id: string; claimedBy?: string }[] };
  const TakeStore = defineStore("sqlite-take-paths", schema<TakeState>());

  const initial = await client.getOrCreateStore({
    definition: TakeStore,
    id: "take-wake",
    initial: { messages: [{ id: "msg-1" }] },
  });
  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "watch-claims",
    event,
    storeName: TakeStore.name,
    storeId: "take-wake",
    instanceId: initial.instanceId,
    sinceVersion: 0,
    readPaths: [["messages", 0, "claimedBy"]],
  });

  const outcome = await client.takeFromStore({
    definition: TakeStore,
    id: "take-wake",
    selector: (s) => s.messages.find((m) => !m.claimedBy),
    claim: (draft, msg) => {
      msg.claimedBy = "worker";
    },
  });

  if (!outcome.matched) throw new Error("take should match");
  expect(outcome.selected).toEqual({ id: "msg-1", claimedBy: "worker" });
  expect(events).toEqual([event]);
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

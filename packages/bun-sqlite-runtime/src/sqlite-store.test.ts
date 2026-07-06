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

  await client.getOrCreateStore({
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

  await client.getOrCreateStore({
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

  await client.getOrCreateStore({
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

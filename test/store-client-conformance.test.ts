import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import * as core from "@yieldstar/core";
import {
  defineStore,
  type SchedulerClient,
  type StoreClient,
  type StorePath,
  type StoreWaiter,
  type WorkflowEvent,
} from "@yieldstar/core";
import { testSchema } from "@yieldstar/test-utils";
import { SqliteStoreClient } from "../packages/bun-sqlite-runtime/src/sqlite-store";
import { MemoryStoreClient } from "../packages/test-runtime/src/memory-store";

type StoreClientHarness = {
  client: StoreClient;
  dispose(): void | Promise<void>;
};

type StoreClientTarget = {
  name: string;
  create(schedulerClient: SchedulerClient): StoreClientHarness | Promise<StoreClientHarness>;
};

type SharedStoreClientTarget = {
  name: string;
  create(schedulerClients: [SchedulerClient, SchedulerClient]):
    | (Omit<StoreClientHarness, "client"> & { clients: [StoreClient, StoreClient] })
    | Promise<Omit<StoreClientHarness, "client"> & { clients: [StoreClient, StoreClient] }>;
};

type DurableStoreClientTarget = {
  name: string;
  create(schedulerClient: SchedulerClient):
    | (StoreClientHarness & {
        restart(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
      })
    | Promise<
        StoreClientHarness & {
          restart(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
        }
      >;
};

type StoreConformanceCase = {
  name: string;
  run(): void | Promise<void>;
};

type AddStoreConformanceCase = (
  name: string,
  run: () => void | Promise<void>
) => void;

function collectStoreConformanceCases(): {
  cases: StoreConformanceCase[];
  addCase: AddStoreConformanceCase;
} {
  const cases: StoreConformanceCase[] = [];
  return {
    cases,
    addCase(name, run) {
      cases.push({ name, run });
    },
  };
}

type State = {
  messages: { id: string }[];
  unrelated?: number;
};

type TakeState = {
  messages: { id: string; claimedBy?: string }[];
};

const event: WorkflowEvent = {
  workflowId: "workflow",
  executionId: "execution",
  params: undefined,
  context: new Map(),
};

function storeClientConformanceCases(target: StoreClientTarget) {
  const Store = defineStore(`${target.name}-store-conformance`, testSchema<State>());
  const TakeStore = defineStore(`${target.name}-take-conformance`, testSchema<TakeState>());
  const { cases, addCase } = collectStoreConformanceCases();

  addCase("concurrent updates both commit", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "update-race",
        initial: { messages: [] },
      });

      const [first, second] = await Promise.all([
        harness.client.updateStore({
          definition: Store,
          id: "update-race",
          updater(draft) {
            draft.messages.push({ id: "a" });
          },
        }),
        harness.client.updateStore({
          definition: Store,
          id: "update-race",
          updater(draft) {
            draft.messages.push({ id: "b" });
          },
        }),
      ]);

      expect([first.version, second.version].sort()).toEqual([1, 2]);
      expect(
        await harness.client.getStore({ definition: Store, id: "update-race" })
      ).toMatchObject({
        state: { messages: [{ id: "a" }, { id: "b" }] },
        version: 2,
      });
    } finally {
      await harness.dispose();
    }
  });

  addCase("async updaters are rejected without committing", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "async-update",
        initial: { messages: [] },
      });

      await expect(
        harness.client.updateStore({
          definition: Store,
          id: "async-update",
          updater: (async (draft: State) => {
            draft.messages.push({ id: "not-committed" });
          }) as any,
        })
      ).rejects.toThrow(/synchronous/);

      expect(
        await harness.client.getStore({ definition: Store, id: "async-update" })
      ).toMatchObject({ state: { messages: [] }, version: 0 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("conditional updates commit from one snapshot and replay ledger-first", async () => {
    const harness = await target.create(noopScheduler());
    try {
      const snapshot = await harness.client.getOrCreateStore({
        definition: Store,
        id: "conditional",
        initial: { messages: [] },
      });
      const stepId = { executionId: "execution", stepKey: "conditional" };
      let updaterRuns = 0;
      const committed = await harness.client.updateStoreFrom({
        definition: Store,
        id: "conditional",
        snapshot,
        stepId,
        updater(draft) {
          updaterRuns++;
          draft.messages.push({ id: "first" });
        },
      });

      await harness.client.updateStore({
        definition: Store,
        id: "conditional",
        updater(draft) {
          draft.messages.push({ id: "second" });
        },
      });

      expect(
        await harness.client.updateStoreFrom({
          definition: Store,
          id: "conditional",
          snapshot: { ...snapshot, instanceId: "" },
          stepId,
          updater() {
            updaterRuns++;
          },
        })
      ).toEqual(committed);
      expect(updaterRuns).toBe(1);

      expect(
        await harness.client.updateStoreFrom({
          definition: Store,
          id: "conditional",
          snapshot,
          updater() {
            updaterRuns++;
          },
        })
      ).toMatchObject({ updated: false, expectedVersion: 0, actualVersion: 2 });
      expect(updaterRuns).toBe(1);
    } finally {
      await harness.dispose();
    }
  });

  addCase("conditional updates reject snapshots without an instance id", async () => {
    const harness = await target.create(noopScheduler());
    try {
      const snapshot = await harness.client.getOrCreateStore({
        definition: Store,
        id: "missing-instance",
        initial: { messages: [] },
      });
      await expect(
        harness.client.updateStoreFrom({
          definition: Store,
          id: "missing-instance",
          snapshot: { ...snapshot, instanceId: "" },
          updater() {},
        })
      ).rejects.toThrow(/missing instanceId/);
    } finally {
      await harness.dispose();
    }
  });

  addCase("step ids make updates exactly-once", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "update-ledger",
        initial: { messages: [] },
      });
      let updaterRuns = 0;
      const update = () =>
        harness.client.updateStore({
          definition: Store,
          id: "update-ledger",
          stepId: { executionId: "execution", stepKey: "append" },
          updater(draft) {
            updaterRuns++;
            draft.messages.push({ id: "once" });
          },
        });

      const first = await update();
      expect(await update()).toEqual(first);
      expect(updaterRuns).toBe(1);
      expect(
        await harness.client.getStore({ definition: Store, id: "update-ledger" })
      ).toMatchObject({ state: { messages: [{ id: "once" }] }, version: 1 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("calls without step ids apply independently", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "external-update",
        initial: { messages: [] },
      });
      let updaterRuns = 0;
      const update = () =>
        harness.client.updateStore({
          definition: Store,
          id: "external-update",
          updater(draft) {
            updaterRuns++;
            draft.messages.push({ id: `${updaterRuns}` });
          },
        });

      await update();
      await update();
      expect(updaterRuns).toBe(2);
      expect(
        await harness.client.getStore({ definition: Store, id: "external-update" })
      ).toMatchObject({ version: 2 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("step ids are scoped by execution and step key", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "ledger-scope",
        initial: { messages: [] },
      });
      const update = (executionId: string, stepKey: string) =>
        harness.client.updateStore({
          definition: Store,
          id: "ledger-scope",
          stepId: { executionId, stepKey },
          updater(draft) {
            draft.messages.push({ id: `${executionId}:${stepKey}` });
          },
        });

      await update("one", "a");
      await update("one", "b");
      await update("two", "a");
      expect(
        await harness.client.getStore({ definition: Store, id: "ledger-scope" })
      ).toMatchObject({
        state: { messages: [{ id: "one:a" }, { id: "one:b" }, { id: "two:a" }] },
        version: 3,
      });
    } finally {
      await harness.dispose();
    }
  });

  addCase("store listing and deletion preserve logical instance semantics", async () => {
    const harness = await target.create(noopScheduler());
    const OtherStore = defineStore(`${target.name}-other-conformance`, testSchema<State>());
    try {
      const first = await harness.client.getOrCreateStore({
        definition: Store,
        id: "b",
        initial: { messages: [] },
      });
      const second = await harness.client.getOrCreateStore({
        definition: Store,
        id: "a",
        initial: { messages: [] },
      });
      await harness.client.getOrCreateStore({
        definition: OtherStore,
        id: "a",
        initial: { messages: [] },
      });

      expect(first.instanceId).toMatch(/^[0-9a-f-]+$/);
      expect(second.instanceId).not.toBe(first.instanceId);
      expect(await harness.client.listStores(Store)).toEqual(["a", "b"]);
      await harness.client.deleteStore({ definition: Store, id: "b" });
      expect(await harness.client.listStores(Store)).toEqual(["a"]);
      await expect(
        harness.client.getStore({ definition: Store, id: "b" })
      ).rejects.toThrow(/does not exist/);
      await harness.client.deleteStore({ definition: Store, id: "missing" });
    } finally {
      await harness.dispose();
    }
  });

  addCase("conditional deletion protects recreated stores and replays exactly-once", async () => {
    const harness = await target.create(noopScheduler());
    try {
      const original = await harness.client.getOrCreateStore({
        definition: Store,
        id: "delete-from",
        initial: { messages: [] },
      });
      await harness.client.updateStore({
        definition: Store,
        id: "delete-from",
        updater(draft) {
          draft.messages.push({ id: "changed" });
        },
      });
      expect(
        await harness.client.deleteStoreFrom({
          definition: Store,
          id: "delete-from",
          snapshot: original,
        })
      ).toMatchObject({ deleted: false, reason: "conflict" });

      const current = await harness.client.getStore({ definition: Store, id: "delete-from" });
      const stepId = { executionId: "execution", stepKey: "delete" };
      expect(
        await harness.client.deleteStoreFrom({
          definition: Store,
          id: "delete-from",
          snapshot: current,
          stepId,
        })
      ).toEqual({ deleted: true });

      const recreated = await harness.client.getOrCreateStore({
        definition: Store,
        id: "delete-from",
        initial: { messages: [] },
      });
      expect(recreated.instanceId).not.toBe(original.instanceId);
      expect(
        await harness.client.deleteStoreFrom({
          definition: Store,
          id: "delete-from",
          snapshot: current,
          stepId,
        })
      ).toEqual({ deleted: true });
      expect(
        await harness.client.getStore({ definition: Store, id: "delete-from" })
      ).toEqual(recreated);
    } finally {
      await harness.dispose();
    }
  });

  addCase("concurrent takes claim distinct items", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "take-race",
        initial: { messages: [{ id: "one" }, { id: "two" }] },
      });
      const take = (claimedBy: string) =>
        harness.client.takeFromStore({
          definition: TakeStore,
          id: "take-race",
          selector: (state) => state.messages.find((message) => !message.claimedBy),
          claim: (_draft, message) => {
            message.claimedBy = claimedBy;
          },
        });

      const [first, second] = await Promise.all([take("a"), take("b")]);
      if (!first.matched || !second.matched) throw new Error("both takes must match");
      expect(first.selected.id).not.toBe(second.selected.id);
      expect([first.version, second.version].sort()).toEqual([1, 2]);
    } finally {
      await harness.dispose();
    }
  });

  addCase("unmatched takes report read paths and can match later", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "take-later",
        initial: { messages: [] },
      });
      const stepId = { executionId: "execution", stepKey: "take" };
      const take = () =>
        harness.client.takeFromStore({
          definition: TakeStore,
          id: "take-later",
          stepId,
          selector: (state) => state.messages.find((message) => !message.claimedBy),
          claim: (_draft, message) => {
            message.claimedBy = "worker";
          },
        });

      const miss = await take();
      if (miss.matched) throw new Error("first take must miss");
      expect(miss.version).toBe(0);
      expect(miss.readPaths).toContainEqual(["messages"]);
      await harness.client.updateStore({
        definition: TakeStore,
        id: "take-later",
        updater(draft) {
          draft.messages.push({ id: "ready" });
        },
      });
      const hit = await take();
      expect(hit.matched).toBe(true);
      expect(await take()).toEqual(hit);
    } finally {
      await harness.dispose();
    }
  });

  addCase("async take claims are rejected without committing", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "async-take",
        initial: { messages: [{ id: "one" }] },
      });
      await expect(
        harness.client.takeFromStore({
          definition: TakeStore,
          id: "async-take",
          selector: (state) => state.messages[0],
          claim: (async (_draft: unknown, message: { claimedBy?: string }) => {
            message.claimedBy = "worker";
          }) as any,
        })
      ).rejects.toThrow(/synchronous/);
      expect(
        await harness.client.getStore({ definition: TakeStore, id: "async-take" })
      ).toMatchObject({ state: { messages: [{ id: "one" }] }, version: 0 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("matched takes replay their recorded result", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "take-ledger",
        initial: { messages: [{ id: "one" }, { id: "two" }] },
      });
      let selectorRuns = 0;
      let claimRuns = 0;
      const take = () =>
        harness.client.takeFromStore({
          definition: TakeStore,
          id: "take-ledger",
          stepId: { executionId: "execution", stepKey: "take" },
          selector(state) {
            selectorRuns++;
            return state.messages.find((message) => !message.claimedBy);
          },
          claim: (_draft, message) => {
            claimRuns++;
            message.claimedBy = "worker";
          },
        });

      const first = await take();
      expect(await take()).toEqual(first);
      expect(selectorRuns).toBe(1);
      expect(claimRuns).toBe(1);
      expect(
        await harness.client.getStore({ definition: TakeStore, id: "take-ledger" })
      ).toMatchObject({ version: 1 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("committed state contains no tracking proxies", async () => {
    const harness = await target.create(noopScheduler());
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "plain-state",
        initial: { messages: [{ id: "one" }] },
      });
      await harness.client.updateStore({
        definition: Store,
        id: "plain-state",
        updater(draft) {
          (draft as Record<string, unknown>).lastMessage = draft.messages[0];
          (draft as Record<string, unknown>).wrapped = { inner: draft.messages };
        },
      });
      const snapshot = await harness.client.getStore({ definition: Store, id: "plain-state" });
      expect(() => structuredClone(snapshot.state)).not.toThrow();
      expect((snapshot.state as Record<string, unknown>).lastMessage).toEqual({ id: "one" });
      expect((snapshot.state as Record<string, unknown>).wrapped).toEqual({
        inner: [{ id: "one" }],
      });
    } finally {
      await harness.dispose();
    }
  });

  addCase("mutating updates do not deep-diff the full state", async () => {
    const harness = await target.create(noopScheduler());
    const diffSpy = spyOn(core, "diffStorePaths");
    try {
      await harness.client.getOrCreateStore({
        definition: Store,
        id: "large-update",
        initial: {
          messages: Array.from({ length: 5000 }, (_, index) => ({ id: `${index}` })),
        },
      });
      await harness.client.updateStore({
        definition: Store,
        id: "large-update",
        updater(draft) {
          draft.messages.push({ id: "new" });
        },
      });

      await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "large-take",
        initial: {
          messages: Array.from({ length: 5000 }, (_, index) => ({ id: `${index}` })),
        },
      });
      const take = await harness.client.takeFromStore({
        definition: TakeStore,
        id: "large-take",
        selector: (state) => state.messages.find((message) => !message.claimedBy),
        claim: (_draft, message) => {
          message.claimedBy = "worker";
        },
      });
      expect(take.matched).toBe(true);
      expect(diffSpy).not.toHaveBeenCalled();
    } finally {
      diffSpy.mockRestore();
      await harness.dispose();
    }
  });
  return cases;
}

function wakeDeliveryConformanceCases(target: StoreClientTarget) {
  const Store = defineStore(`${target.name}-wake-conformance`, testSchema<State>());
  const { cases, addCase } = collectStoreConformanceCases();

  addCase("updates wake matching waiters but not unrelated paths", async () => {
    const events: WorkflowEvent[] = [];
    const harness = await target.create(collectingScheduler(events));
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "selective",
        initial: { messages: [] },
      });
      await harness.client.registerWaiter(waiter(Store.name, "selective", initial.instanceId, 0));
      await harness.client.updateStore({
        definition: Store,
        id: "selective",
        updater(draft) {
          draft.unrelated = 1;
        },
      });
      expect(events).toEqual([]);
      await harness.client.updateStore({
        definition: Store,
        id: "selective",
        updater(draft) {
          draft.messages.push({ id: "ready" });
        },
      });
      expect(events).toEqual([event]);
    } finally {
      await harness.dispose();
    }
  });

  addCase("replacement state updates wake matching waiters", async () => {
    const events: WorkflowEvent[] = [];
    const harness = await target.create(collectingScheduler(events));
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "replacement",
        initial: { messages: [] },
      });
      await harness.client.registerWaiter(
        waiter(Store.name, "replacement", initial.instanceId, initial.version)
      );
      await harness.client.updateStore({
        definition: Store,
        id: "replacement",
        updater: () => ({ messages: [{ id: "ready" }] }),
      });
      expect(events).toEqual([event]);
    } finally {
      await harness.dispose();
    }
  });

  addCase("take claims wake waiters observing the changed path", async () => {
    type ClaimedState = { messages: { id: string; claimedBy?: string }[] };
    const TakeStore = defineStore(
      `${target.name}-wake-take-conformance`,
      testSchema<ClaimedState>()
    );
    const events: WorkflowEvent[] = [];
    const harness = await target.create(collectingScheduler(events));
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: TakeStore,
        id: "take-wake",
        initial: { messages: [{ id: "one" }] },
      });
      await harness.client.registerWaiter({
        ...waiter(TakeStore.name, "take-wake", initial.instanceId, initial.version),
        readPaths: [["messages", 0, "claimedBy"]],
      });
      const result = await harness.client.takeFromStore({
        definition: TakeStore,
        id: "take-wake",
        selector: (state) => state.messages.find((message) => !message.claimedBy),
        claim: (_draft, message) => {
          message.claimedBy = "worker";
        },
      });
      if (!result.matched) throw new Error("take must match");
      expect(result.selected).toEqual({ id: "one", claimedBy: "worker" });
      expect(events).toEqual([event]);
    } finally {
      await harness.dispose();
    }
  });

  addCase("take splices wake waiters observing shifted indices", async () => {
    type QueueState = { messages: { id: string }[] };
    const QueueStore = defineStore(
      `${target.name}-wake-splice-conformance`,
      testSchema<QueueState>()
    );
    const events: WorkflowEvent[] = [];
    const harness = await target.create(collectingScheduler(events));
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: QueueStore,
        id: "take-splice",
        initial: { messages: [{ id: "one" }, { id: "two" }] },
      });
      await harness.client.registerWaiter({
        ...waiter(QueueStore.name, "take-splice", initial.instanceId, initial.version),
        readPaths: [["messages", 0, "id"]],
      });
      await harness.client.takeFromStore({
        definition: QueueStore,
        id: "take-splice",
        selector: (state) => state.messages[0],
        claim: (draft) => {
          draft.messages.splice(0, 1);
        },
      });
      expect(events).toEqual([event]);
      expect(
        await harness.client.getStore({ definition: QueueStore, id: "take-splice" })
      ).toMatchObject({ state: { messages: [{ id: "two" }] }, version: 1 });
    } finally {
      await harness.dispose();
    }
  });

  addCase("stale waiter registration wakes immediately and does not linger", async () => {
    const events: WorkflowEvent[] = [];
    const harness = await target.create(collectingScheduler(events));
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "stale",
        initial: { messages: [] },
      });
      await harness.client.updateStore({
        definition: Store,
        id: "stale",
        updater(draft) {
          draft.messages.push({ id: "first" });
        },
      });
      await harness.client.registerWaiter(waiter(Store.name, "stale", initial.instanceId, 0));
      expect(events).toEqual([event]);
      events.length = 0;
      await harness.client.updateStore({
        definition: Store,
        id: "stale",
        updater(draft) {
          draft.messages.push({ id: "second" });
        },
      });
      expect(events).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  addCase("failed stale waiter delivery is retried by an unrelated commit", async () => {
    const events: WorkflowEvent[] = [];
    let attempts = 0;
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const harness = await target.create({
      async requestWakeUp(wakeEvent) {
        attempts++;
        if (attempts === 1) throw new Error("temporary scheduler failure");
        events.push(wakeEvent);
      },
    });
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "stale-retry",
        initial: { messages: [] },
      });
      await harness.client.updateStore({
        definition: Store,
        id: "stale-retry",
        updater(draft) {
          draft.messages.push({ id: "first" });
        },
      });
      await harness.client.registerWaiter(
        waiter(Store.name, "stale-retry", initial.instanceId, initial.version)
      );
      expect(attempts).toBe(1);
      await harness.client.updateStore({
        definition: Store,
        id: "stale-retry",
        updater(draft) {
          draft.unrelated = 1;
        },
      });
      expect(attempts).toBe(2);
      expect(events).toEqual([event]);
    } finally {
      errorSpy.mockRestore();
      await harness.dispose();
    }
  });

  addCase("an unrelated commit retries failed delivery", async () => {
    const events: WorkflowEvent[] = [];
    let attempts = 0;
    let updaterRuns = 0;
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const harness = await target.create({
      async requestWakeUp(wakeEvent) {
        attempts++;
        if (attempts === 1) throw new Error("temporary scheduler failure");
        events.push(wakeEvent);
      },
    });
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "retry",
        initial: { messages: [] },
      });
      await harness.client.registerWaiter(waiter(Store.name, "retry", initial.instanceId, 0));
      const update = () =>
        harness.client.updateStore({
          definition: Store,
          id: "retry",
          stepId: { executionId: "producer", stepKey: "append" },
          updater(draft) {
            updaterRuns++;
            draft.messages.push({ id: "ready" });
          },
        });
      const committed = await update();
      expect(attempts).toBe(1);
      expect(events).toEqual([]);
      expect(await update()).toEqual(committed);
      expect(updaterRuns).toBe(1);
      expect(attempts).toBe(1);
      await harness.client.updateStore({
        definition: Store,
        id: "retry",
        updater(draft) {
          draft.unrelated = 1;
        },
      });
      expect(attempts).toBe(2);
      expect(events).toEqual([event]);
    } finally {
      errorSpy.mockRestore();
      await harness.dispose();
    }
  });

  addCase("one failed wake does not block another", async () => {
    const delivered: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const harness = await target.create({
      async requestWakeUp(wakeEvent) {
        if (wakeEvent.executionId === "poison") throw new Error("poisoned wake");
        delivered.push(wakeEvent.executionId);
      },
    });
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "poison",
        initial: { messages: [] },
      });
      for (const executionId of ["poison", "healthy"]) {
        await harness.client.registerWaiter({
          ...waiter(Store.name, "poison", initial.instanceId, 0),
          executionId,
          event: { ...event, executionId },
        });
      }
      await harness.client.updateStore({
        definition: Store,
        id: "poison",
        updater(draft) {
          draft.messages.push({ id: "ready" });
        },
      });
      expect(delivered).toEqual(["healthy"]);
    } finally {
      errorSpy.mockRestore();
      await harness.dispose();
    }
  });

  addCase("deleted waiters do not transfer pending wakes to recreated stores", async () => {
    const events: WorkflowEvent[] = [];
    let attempts = 0;
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const harness = await target.create({
      async requestWakeUp(wakeEvent) {
        attempts++;
        if (attempts === 1) throw new Error("temporary scheduler failure");
        events.push(wakeEvent);
      },
    });
    try {
      const original = await harness.client.getOrCreateStore({
        definition: Store,
        id: "recreated",
        initial: { messages: [] },
      });
      const originalWaiter = waiter(Store.name, "recreated", original.instanceId, 0);
      await harness.client.registerWaiter(originalWaiter);
      await harness.client.updateStore({
        definition: Store,
        id: "recreated",
        updater(draft) {
          draft.messages.push({ id: "old" });
        },
      });
      await harness.client.deleteStore({ definition: Store, id: "recreated" });
      const recreated = await harness.client.getOrCreateStore({
        definition: Store,
        id: "recreated",
        initial: { messages: [] },
      });
      await harness.client.registerWaiter({ ...originalWaiter, instanceId: recreated.instanceId });
      await harness.client.updateStore({
        definition: Store,
        id: "recreated",
        updater(draft) {
          draft.unrelated = 1;
        },
      });
      expect(attempts).toBe(1);
      expect(events).toEqual([]);
    } finally {
      errorSpy.mockRestore();
      await harness.dispose();
    }
  });
  return cases;
}

function sharedBackendConformanceCases(target: SharedStoreClientTarget) {
  const Store = defineStore(`${target.name}-shared-conformance`, testSchema<State>());
  const { cases, addCase } = collectStoreConformanceCases();

  addCase("wake delivery preserves a waiter re-registered by another client", async () => {
    let secondClient: StoreClient;
    let wakeCount = 0;
    const harness = await target.create([
      {
        async requestWakeUp() {
          wakeCount++;
          if (wakeCount === 1) {
            const current = await secondClient.getStore({ definition: Store, id: "re-register" });
            await secondClient.registerWaiter(
              waiter(Store.name, "re-register", current.instanceId, current.version)
            );
          }
        },
      },
      noopScheduler(),
    ]);
    secondClient = harness.clients[1];
    try {
      const initial = await harness.clients[0].getOrCreateStore({
        definition: Store,
        id: "re-register",
        initial: { messages: [] },
      });
      await harness.clients[0].registerWaiter(
        waiter(Store.name, "re-register", initial.instanceId, initial.version)
      );
      for (const id of ["first", "second"]) {
        await harness.clients[0].updateStore({
          definition: Store,
          id: "re-register",
          updater(draft) {
            draft.messages.push({ id });
          },
        });
      }
      expect(wakeCount).toBe(2);
    } finally {
      await harness.dispose();
    }
  });
  return cases;
}

function durableWakeConformanceCases(target: DurableStoreClientTarget) {
  const Store = defineStore(`${target.name}-durable-wake-conformance`, testSchema<State>());
  const { cases, addCase } = collectStoreConformanceCases();

  addCase("a new client recovers a committed wake", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const harness = await target.create({
      async requestWakeUp() {
        throw new Error("scheduler unavailable");
      },
    });
    try {
      const initial = await harness.client.getOrCreateStore({
        definition: Store,
        id: "recovery",
        initial: { messages: [] },
      });
      await harness.client.registerWaiter(
        waiter(Store.name, "recovery", initial.instanceId, initial.version)
      );
      await harness.client.updateStore({
        definition: Store,
        id: "recovery",
        updater(draft) {
          draft.messages.push({ id: "ready" });
        },
      });

      const recovered: WorkflowEvent[] = [];
      let resolveRecovery!: () => void;
      const recoveryComplete = new Promise<void>((resolve) => {
        resolveRecovery = resolve;
      });
      await harness.restart({
        async requestWakeUp(recoveredEvent) {
          recovered.push(recoveredEvent);
          resolveRecovery();
        },
      });
      await recoveryComplete;
      expect(recovered).toEqual([event]);
    } finally {
      errorSpy.mockRestore();
      await harness.dispose();
    }
  });
  return cases;
}

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

for (const target of [memory, sqlite]) {
  describe(`${target.name} store client`, () => {
    for (const { name, run } of storeClientConformanceCases(target)) {
      test(name, run);
    }
  });

  describe(`${target.name} wake delivery`, () => {
    for (const { name, run } of wakeDeliveryConformanceCases(target)) {
      test(name, run);
    }
  });
}

describe(`${sharedSqlite.name} shared backend`, () => {
  for (const { name, run } of sharedBackendConformanceCases(sharedSqlite)) {
    test(name, run);
  }
});

describe(`${durableSqlite.name} durable wake delivery`, () => {
  for (const { name, run } of durableWakeConformanceCases(durableSqlite)) {
    test(name, run);
  }
});

test("memory store retries an updater after a commit conflict", async () => {
  type State = { messages: string[] };
  const Store = defineStore("memory-cas-retry", testSchema<State>());
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

function waiter(
  storeName: string,
  storeId: string,
  instanceId: string,
  sinceVersion: number
): StoreWaiter {
  return {
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "wait",
    event,
    storeName,
    storeId,
    instanceId,
    sinceVersion,
    readPaths: [["messages"]] as StorePath[],
  };
}

function noopScheduler(): SchedulerClient {
  return { async requestWakeUp() {} };
}

function collectingScheduler(events: WorkflowEvent[]): SchedulerClient {
  return {
    async requestWakeUp(wakeEvent) {
      events.push(wakeEvent);
    },
  };
}

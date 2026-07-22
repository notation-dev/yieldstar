import {
  defineStore,
  type SchedulerClient,
  type StandardSchemaV1,
  type StoreClient,
  type StorePath,
  type StoreWaiter,
  type WorkflowEvent,
} from "@yieldstar/core";
import * as core from "@yieldstar/core";
import { describe, expect, test, vi } from "vitest";

export type StoreConformanceHarness = {
  client: StoreClient;
  /** Creates another client connected to the same backend. */
  createPeer?(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
  /** Simulates opening the same durable backend in a new process. */
  restart?(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
  dispose?(): void | Promise<void>;
};

export type StoreConformanceFactory = (
  schedulerClient: SchedulerClient
) => StoreConformanceHarness | Promise<StoreConformanceHarness>;

export type StoreConformanceOptions = {
  name: string;
  create: StoreConformanceFactory;
};

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

const noopScheduler: SchedulerClient = { async requestWakeUp() {} };

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "yieldstar-conformance",
      validate(value) {
        return { value: value as T };
      },
    },
  };
}

function waiter(
  storeName: string,
  storeId: string,
  instanceId: string,
  sinceVersion: number,
  readPaths: StorePath[] = [["messages"]]
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
    readPaths,
  };
}

async function eventually(assertion: () => void | Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

/** Registers the normative YieldStar store connector qualification suite. */
export function registerStoreClientConformance({
  name,
  create,
}: StoreConformanceOptions): void {
  const Store = defineStore(`${name}-store-conformance`, schema<State>());
  const TakeStore = defineStore(`${name}-take-conformance`, schema<TakeState>());

  describe(`${name} store connector conformance`, () => {
    test("creates, reads, lists, deletes, and recreates logical stores", async () => {
      const harness = await create(noopScheduler);
      const OtherStore = defineStore(`${name}-other-conformance`, schema<State>());
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

        expect(first.instanceId).toBeTruthy();
        expect(second.instanceId).not.toBe(first.instanceId);
        expect(await harness.client.listStores(Store)).toEqual(["a", "b"]);
        await harness.client.deleteStore({ definition: Store, id: "b" });
        expect(await harness.client.listStores(Store)).toEqual(["a"]);
        await expect(
          harness.client.getStore({ definition: Store, id: "b" })
        ).rejects.toThrow();
        const recreated = await harness.client.getOrCreateStore({
          definition: Store,
          id: "b",
          initial: { messages: [] },
        });
        expect(recreated.instanceId).not.toBe(first.instanceId);
        await harness.client.deleteStore({ definition: Store, id: "missing" });
      } finally {
        await harness.dispose?.();
      }
    });

    test("rejects asynchronous updaters and claims without committing", async () => {
      const harness = await create(noopScheduler);
      try {
        await harness.client.getOrCreateStore({
          definition: TakeStore,
          id: "sync-callbacks",
          initial: { messages: [{ id: "one" }] },
        });
        await expect(
          harness.client.updateStore({
            definition: TakeStore,
            id: "sync-callbacks",
            updater: (async (draft: TakeState) => {
              draft.messages.push({ id: "two" });
            }) as never,
          })
        ).rejects.toThrow(/synchronous/);
        await expect(
          harness.client.takeFromStore({
            definition: TakeStore,
            id: "sync-callbacks",
            selector: (state) => state.messages[0],
            claim: (async (_draft: TakeState, selected: { claimedBy?: string }) => {
              selected.claimedBy = "worker";
            }) as never,
          })
        ).rejects.toThrow(/synchronous/);
        expect(
          await harness.client.getStore({ definition: TakeStore, id: "sync-callbacks" })
        ).toMatchObject({ state: { messages: [{ id: "one" }] }, version: 0 });
      } finally {
        await harness.dispose?.();
      }
    });

    test("retries an updater after an interleaved CAS conflict", async () => {
      let validations = 0;
      let racing = false;
      let release!: () => void;
      const bothPrepared = new Promise<void>((resolve) => {
        release = resolve;
      });
      const raceSchema: StandardSchemaV1<unknown, { messages: string[] }> = {
        "~standard": {
          version: 1 as const,
          vendor: "yieldstar-conformance",
          async validate(value: unknown) {
            if (!racing) return { value: value as { messages: string[] } };
            validations++;
            if (validations === 2) release();
            if (validations <= 2) await bothPrepared;
            return { value: value as { messages: string[] } };
          },
        },
      };
      const RaceStore = defineStore(`${name}-cas-race-conformance`, raceSchema);
      const harness = await create(noopScheduler);
      let updaterRuns = 0;
      try {
        await harness.client.getOrCreateStore({
          definition: RaceStore,
          id: "race",
          initial: { messages: [] },
        });
        racing = true;
        validations = 0;
        await Promise.all(
          ["a", "b"].map((id) =>
            harness.client.updateStore({
              definition: RaceStore,
              id: "race",
              updater(draft) {
                updaterRuns++;
                draft.messages.push(id);
              },
            })
          )
        );
        expect(updaterRuns).toBe(3);
        const final = await harness.client.getStore({ definition: RaceStore, id: "race" });
        expect(final.version).toBe(2);
        expect(final.state.messages.sort()).toEqual(["a", "b"]);
      } finally {
        await harness.dispose?.();
      }
    });

    test("makes a step receipt and mutation exactly-once under concurrent replay", async () => {
      const harness = await create(noopScheduler);
      let updaterRuns = 0;
      try {
        await harness.client.getOrCreateStore({
          definition: Store,
          id: "receipt-race",
          initial: { messages: [] },
        });
        const results = await Promise.all(
          ["a", "b"].map((id) =>
            harness.client.updateStore({
              definition: Store,
              id: "receipt-race",
              stepId: { executionId: "producer", stepKey: "append" },
              updater(draft) {
                updaterRuns++;
                draft.messages.push({ id });
              },
            })
          )
        );
        expect(results[1]).toEqual(results[0]);
        expect(updaterRuns).toBeGreaterThanOrEqual(1);
        expect(updaterRuns).toBeLessThanOrEqual(2);
        expect(
          await harness.client.getStore({ definition: Store, id: "receipt-race" })
        ).toMatchObject({ state: { messages: [{ id: results[0].state.messages[0].id }] }, version: 1 });
        let replayRuns = 0;
        expect(
          await harness.client.updateStore({
            definition: Store,
            id: "receipt-race",
            stepId: { executionId: "producer", stepKey: "append" },
            updater() {
              replayRuns++;
            },
          })
        ).toEqual(results[0]);
        expect(replayRuns).toBe(0);

        await harness.client.deleteStore({ definition: Store, id: "receipt-race" });
        const recreated = await harness.client.getOrCreateStore({
          definition: Store,
          id: "receipt-race",
          initial: { messages: [] },
        });
        expect(
          await harness.client.updateStore({
            definition: Store,
            id: "receipt-race",
            stepId: { executionId: "producer", stepKey: "append" },
            updater() { replayRuns++; },
          })
        ).toEqual(results[0]);
        expect(replayRuns).toBe(0);
        expect(await harness.client.getStore({ definition: Store, id: "receipt-race" })).toEqual(recreated);
      } finally {
        await harness.dispose?.();
      }
    });

    test("scopes receipts by execution and step key", async () => {
      const harness = await create(noopScheduler);
      try {
        await harness.client.getOrCreateStore({
          definition: Store,
          id: "receipt-scope",
          initial: { messages: [] },
        });
        for (const [executionId, stepKey] of [["one", "a"], ["one", "b"], ["two", "a"]]) {
          await harness.client.updateStore({
            definition: Store,
            id: "receipt-scope",
            stepId: { executionId, stepKey },
            updater(draft) {
              draft.messages.push({ id: `${executionId}:${stepKey}` });
            },
          });
        }
        expect(
          await harness.client.getStore({ definition: Store, id: "receipt-scope" })
        ).toMatchObject({ version: 3 });
      } finally {
        await harness.dispose?.();
      }
    });

    test("applies calls without step ids independently and returns detached state", async () => {
      const harness = await create(noopScheduler);
      try {
        const initial = await harness.client.getOrCreateStore({
          definition: Store,
          id: "external-update",
          initial: { messages: [] },
        });
        initial.state.messages.push({ id: "caller-only" });
        for (const id of ["one", "two"]) {
          const result = await harness.client.updateStore({
            definition: Store,
            id: "external-update",
            updater(draft) { draft.messages.push({ id }); },
          });
          result.state.messages.push({ id: "result-only" });
        }
        expect(
          await harness.client.getStore({ definition: Store, id: "external-update" })
        ).toMatchObject({ state: { messages: [{ id: "one" }, { id: "two" }] }, version: 2 });
      } finally {
        await harness.dispose?.();
      }
    });

    test("committed state contains no tracking proxies", async () => {
      const harness = await create(noopScheduler);
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
        expect((snapshot.state as unknown as Record<string, unknown>).lastMessage).toEqual({ id: "one" });
        expect((snapshot.state as unknown as Record<string, unknown>).wrapped).toEqual({
          inner: [{ id: "one" }],
        });
      } finally {
        await harness.dispose?.();
      }
    });

    test("mutating updates do not deep-diff the full state", async () => {
      const harness = await create(noopScheduler);
      const diffSpy = vi.spyOn(core, "diffStorePaths");
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
          updater(draft) { draft.messages.push({ id: "new" }); },
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
          claim: (_draft, message) => { message.claimedBy = "worker"; },
        });
        expect(take.matched).toBe(true);
        expect(diffSpy).not.toHaveBeenCalled();
      } finally {
        diffSpy.mockRestore();
        await harness.dispose?.();
      }
    });

    test("conditional updates conflict and replay ledger-first", async () => {
      const harness = await create(noopScheduler);
      let updaterRuns = 0;
      try {
        const snapshot = await harness.client.getOrCreateStore({
          definition: Store,
          id: "conditional",
          initial: { messages: [] },
        });
        const stepId = { executionId: "execution", stepKey: "conditional" };
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
            snapshot: { ...snapshot, instanceId: "wrong" },
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
        await expect(
          harness.client.updateStoreFrom({
            definition: Store,
            id: "conditional",
            snapshot: { ...snapshot, instanceId: "" },
            updater() {},
          })
        ).rejects.toThrow(/missing instanceId/);
      } finally {
        await harness.dispose?.();
      }
    });

    test("claims distinct values and records only matched takes", async () => {
      const harness = await create(noopScheduler);
      try {
        await harness.client.getOrCreateStore({
          definition: TakeStore,
          id: "take",
          initial: { messages: [{ id: "one" }, { id: "two" }] },
        });
        const take = (worker: string, stepKey: string) =>
          harness.client.takeFromStore({
            definition: TakeStore,
            id: "take",
            stepId: { executionId: "execution", stepKey },
            selector: (state) => state.messages.find((message) => !message.claimedBy),
            claim: (_draft, selected) => {
              selected.claimedBy = worker;
            },
          });
        const [first, second] = await Promise.all([take("a", "a"), take("b", "b")]);
        if (!first.matched || !second.matched) throw new Error("both takes must match");
        expect(first.selected.id).not.toBe(second.selected.id);
        expect([first.version, second.version].sort()).toEqual([1, 2]);
        expect(await take("ignored", "a")).toEqual(first);

        const miss = await harness.client.takeFromStore({
          definition: TakeStore,
          id: "take",
          stepId: { executionId: "execution", stepKey: "later" },
          selector: (state) => state.messages.find((message) => !message.claimedBy),
          claim() {},
        });
        if (miss.matched) throw new Error("take must not match");
        expect(miss.readPaths).toContainEqual(["messages"]);
        await harness.client.updateStore({
          definition: TakeStore,
          id: "take",
          updater(draft) {
            draft.messages.push({ id: "three" });
          },
        });
        expect(
          await harness.client.takeFromStore({
            definition: TakeStore,
            id: "take",
            stepId: { executionId: "execution", stepKey: "later" },
            selector: (state) => state.messages.find((message) => !message.claimedBy),
            claim: (_draft, selected) => {
              selected.claimedBy = "c";
            },
          })
        ).toMatchObject({ matched: true });
      } finally {
        await harness.dispose?.();
      }
    });

    test("protects recreated stores during conditional deletion and replays the receipt", async () => {
      const harness = await create(noopScheduler);
      try {
        const original = await harness.client.getOrCreateStore({
          definition: Store,
          id: "delete",
          initial: { messages: [] },
        });
        await harness.client.updateStore({
          definition: Store,
          id: "delete",
          updater(draft) {
            draft.messages.push({ id: "changed" });
          },
        });
        expect(
          await harness.client.deleteStoreFrom({ definition: Store, id: "delete", snapshot: original })
        ).toMatchObject({ deleted: false, reason: "conflict" });
        const current = await harness.client.getStore({ definition: Store, id: "delete" });
        const stepId = { executionId: "execution", stepKey: "delete" };
        expect(
          await harness.client.deleteStoreFrom({ definition: Store, id: "delete", snapshot: current, stepId })
        ).toEqual({ deleted: true });
        const recreated = await harness.client.getOrCreateStore({
          definition: Store,
          id: "delete",
          initial: { messages: [] },
        });
        expect(recreated.instanceId).not.toBe(original.instanceId);
        expect(
          await harness.client.deleteStoreFrom({ definition: Store, id: "delete", snapshot: current, stepId })
        ).toEqual({ deleted: true });
        expect(await harness.client.getStore({ definition: Store, id: "delete" })).toEqual(recreated);
      } finally {
        await harness.dispose?.();
      }
    });

    test("wakes intersecting waiters and consumes successful delivery", async () => {
      const events: WorkflowEvent[] = [];
      const harness = await create({ async requestWakeUp(wakeEvent) { events.push(wakeEvent); } });
      try {
        const initial = await harness.client.getOrCreateStore({
          definition: Store,
          id: "selective-wake",
          initial: { messages: [] },
        });
        await harness.client.registerWaiter(waiter(Store.name, "selective-wake", initial.instanceId, 0));
        await harness.client.updateStore({
          definition: Store,
          id: "selective-wake",
          updater(draft) {
            draft.unrelated = 1;
          },
        });
        expect(events).toEqual([]);
        await harness.client.updateStore({
          definition: Store,
          id: "selective-wake",
          updater(draft) {
            draft.messages.push({ id: "ready" });
          },
        });
        await eventually(() => expect(events).toEqual([event]));
        await harness.client.updateStore({
          definition: Store,
          id: "selective-wake",
          updater(draft) {
            draft.messages.push({ id: "again" });
          },
        });
        expect(events).toEqual([event]);
      } finally {
        await harness.dispose?.();
      }
    });

    test("wakes for replacement, take-claim, and shifted-array paths", async () => {
      type QueueState = { messages: { id: string; claimedBy?: string }[] };
      const QueueStore = defineStore(`${name}-wake-paths-conformance`, schema<QueueState>());
      const events: WorkflowEvent[] = [];
      const harness = await create({ async requestWakeUp(wakeEvent) { events.push(wakeEvent); } });
      try {
        const replacement = await harness.client.getOrCreateStore({
          definition: QueueStore,
          id: "replacement",
          initial: { messages: [] },
        });
        await harness.client.registerWaiter(
          waiter(QueueStore.name, "replacement", replacement.instanceId, replacement.version)
        );
        await harness.client.updateStore({
          definition: QueueStore,
          id: "replacement",
          updater: () => ({ messages: [{ id: "ready" }] }),
        });

        const claim = await harness.client.getOrCreateStore({
          definition: QueueStore,
          id: "claim",
          initial: { messages: [{ id: "one" }] },
        });
        await harness.client.registerWaiter(
          waiter(QueueStore.name, "claim", claim.instanceId, claim.version, [["messages", 0, "claimedBy"]])
        );
        await harness.client.takeFromStore({
          definition: QueueStore,
          id: "claim",
          selector: (state) => state.messages[0],
          claim: (_draft, selected) => { selected.claimedBy = "worker"; },
        });

        const splice = await harness.client.getOrCreateStore({
          definition: QueueStore,
          id: "splice",
          initial: { messages: [{ id: "one" }, { id: "two" }] },
        });
        await harness.client.registerWaiter(
          waiter(QueueStore.name, "splice", splice.instanceId, splice.version, [["messages", 0, "id"]])
        );
        await harness.client.takeFromStore({
          definition: QueueStore,
          id: "splice",
          selector: (state) => state.messages[0],
          claim: (draft) => { draft.messages.splice(0, 1); },
        });
        await eventually(() => expect(events).toHaveLength(3));
      } finally {
        await harness.dispose?.();
      }
    });

    test("immediately wakes a stale registration and does not retain it", async () => {
      const events: WorkflowEvent[] = [];
      const harness = await create({ async requestWakeUp(wakeEvent) { events.push(wakeEvent); } });
      try {
        const initial = await harness.client.getOrCreateStore({
          definition: Store,
          id: "stale-registration",
          initial: { messages: [] },
        });
        await harness.client.updateStore({
          definition: Store,
          id: "stale-registration",
          updater(draft) { draft.messages.push({ id: "first" }); },
        });
        await harness.client.registerWaiter(
          waiter(Store.name, "stale-registration", initial.instanceId, initial.version)
        );
        await eventually(() => expect(events).toEqual([event]));
        await harness.client.updateStore({
          definition: Store,
          id: "stale-registration",
          updater(draft) { draft.messages.push({ id: "second" }); },
        });
        expect(events).toEqual([event]);
      } finally {
        await harness.dispose?.();
      }
    });

    test("retries failed stale-registration delivery after an unrelated commit", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const events: WorkflowEvent[] = [];
      let attempts = 0;
      const harness = await create({
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
          updater(draft) { draft.messages.push({ id: "first" }); },
        });
        await harness.client.registerWaiter(
          waiter(Store.name, "stale-retry", initial.instanceId, initial.version)
        );
        expect(attempts).toBe(1);
        await harness.client.updateStore({
          definition: Store,
          id: "stale-retry",
          updater(draft) { draft.unrelated = 1; },
        });
        await eventually(() => expect(events).toEqual([event]));
        expect(attempts).toBe(2);
      } finally {
        await harness.dispose?.();
        errorSpy.mockRestore();
      }
    });

    test("does not lose a waiter registration racing a commit", async () => {
      const events: WorkflowEvent[] = [];
      const harness = await create({ async requestWakeUp(wakeEvent) { events.push(wakeEvent); } });
      try {
        for (let index = 0; index < 10; index++) {
          const id = `registration-race-${index}`;
          const initial = await harness.client.getOrCreateStore({
            definition: Store,
            id,
            initial: { messages: [] },
          });
          const register = () =>
            harness.client.registerWaiter(waiter(Store.name, id, initial.instanceId, initial.version));
          const update = () =>
            harness.client.updateStore({
              definition: Store,
              id,
              updater(draft) {
                draft.messages.push({ id: "ready" });
              },
            });
          await Promise.all(index % 2 === 0 ? [register(), update()] : [update(), register()]);
        }
        await eventually(() => expect(events).toHaveLength(10));
      } finally {
        await harness.dispose?.();
      }
    });

    test("retries failed wakes without blocking healthy waiters", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const attempts = new Map<string, number>();
      const delivered: string[] = [];
      const harness = await create({
        async requestWakeUp(wakeEvent) {
          const count = (attempts.get(wakeEvent.executionId) ?? 0) + 1;
          attempts.set(wakeEvent.executionId, count);
          if (wakeEvent.executionId === "retry" && count === 1) throw new Error("temporary failure");
          delivered.push(wakeEvent.executionId);
        },
      });
      try {
        const initial = await harness.client.getOrCreateStore({
          definition: Store,
          id: "retry-wake",
          initial: { messages: [] },
        });
        for (const executionId of ["retry", "healthy"]) {
          await harness.client.registerWaiter({
            ...waiter(Store.name, "retry-wake", initial.instanceId, initial.version),
            executionId,
            event: { ...event, executionId },
          });
        }
        await harness.client.updateStore({
          definition: Store,
          id: "retry-wake",
          updater(draft) {
            draft.messages.push({ id: "ready" });
          },
        });
        await eventually(() => expect(delivered).toContain("healthy"));
        await harness.client.updateStore({
          definition: Store,
          id: "retry-wake",
          updater(draft) {
            draft.unrelated = 1;
          },
        });
        await eventually(() => expect(delivered).toContain("retry"));
      } finally {
        await harness.dispose?.();
        errorSpy.mockRestore();
      }
    });

    test("does not transfer a pending wake to a recreated store", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let attempts = 0;
      const delivered: WorkflowEvent[] = [];
      const harness = await create({
        async requestWakeUp(wakeEvent) {
          attempts++;
          if (attempts === 1) throw new Error("temporary failure");
          delivered.push(wakeEvent);
        },
      });
      try {
        const original = await harness.client.getOrCreateStore({
          definition: Store,
          id: "recreated-wake",
          initial: { messages: [] },
        });
        await harness.client.registerWaiter(
          waiter(Store.name, "recreated-wake", original.instanceId, original.version)
        );
        await harness.client.updateStore({
          definition: Store,
          id: "recreated-wake",
          updater(draft) { draft.messages.push({ id: "old" }); },
        });
        await harness.client.deleteStore({ definition: Store, id: "recreated-wake" });
        const recreated = await harness.client.getOrCreateStore({
          definition: Store,
          id: "recreated-wake",
          initial: { messages: [] },
        });
        await harness.client.updateStore({
          definition: Store,
          id: "recreated-wake",
          updater(draft) { draft.unrelated = 1; },
        });
        expect(recreated.instanceId).not.toBe(original.instanceId);
        expect(attempts).toBe(1);
        expect(delivered).toEqual([]);
      } finally {
        await harness.dispose?.();
        errorSpy.mockRestore();
      }
    });

    test("qualifies declared shared-client and durable-delivery capabilities", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const delivered: WorkflowEvent[] = [];
      const harness = await create({
        async requestWakeUp() {
          throw new Error("scheduler unavailable");
        },
      });
      try {
        if (harness.createPeer) {
          let wakeCount = 0;
          let peer!: StoreClient;
          const primary = await harness.createPeer({
            async requestWakeUp() {
              wakeCount++;
              if (wakeCount === 1) {
                const current = await peer.getStore({ definition: Store, id: "wake-generation" });
                await peer.registerWaiter(
                  waiter(Store.name, "wake-generation", current.instanceId, current.version)
                );
              }
            },
          });
          peer = await harness.createPeer(noopScheduler);
          const initial = await harness.client.getOrCreateStore({
            definition: Store,
            id: "shared-client",
            initial: { messages: [] },
          });
          const results = await Promise.all([
            harness.client.updateStore({
              definition: Store,
              id: "shared-client",
              updater(draft) { draft.messages.push({ id: "a" }); },
            }),
            peer.updateStore({
              definition: Store,
              id: "shared-client",
              updater(draft) { draft.messages.push({ id: "b" }); },
            }),
          ]);
          expect(results.map((result) => result.version).sort()).toEqual([1, 2]);
          expect(initial.version).toBe(0);

          const wakeInitial = await primary.getOrCreateStore({
            definition: Store,
            id: "wake-generation",
            initial: { messages: [] },
          });
          await primary.registerWaiter(
            waiter(Store.name, "wake-generation", wakeInitial.instanceId, wakeInitial.version)
          );
          for (const id of ["first", "second"]) {
            await primary.updateStore({
              definition: Store,
              id: "wake-generation",
              updater(draft) { draft.messages.push({ id }); },
            });
          }
          await eventually(() => expect(wakeCount).toBe(2));
        }

        if (harness.restart) {
          const initial = await harness.client.getOrCreateStore({
            definition: Store,
            id: "durable-wake",
            initial: { messages: [] },
          });
          await harness.client.registerWaiter(
            waiter(Store.name, "durable-wake", initial.instanceId, initial.version)
          );
          await harness.client.updateStore({
            definition: Store,
            id: "durable-wake",
            updater(draft) { draft.messages.push({ id: "ready" }); },
          });
          await harness.restart({ async requestWakeUp(wakeEvent) { delivered.push(wakeEvent); } });
          await eventually(() => expect(delivered).toContainEqual(event));
        }
      } finally {
        await harness.dispose?.();
        errorSpy.mockRestore();
      }
    });
  });
}

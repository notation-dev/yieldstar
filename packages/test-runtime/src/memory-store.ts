import type { SchedulerClient } from "@yieldstar/core";
import {
  assertSynchronousClaim,
  cloneStoreState,
  diffStorePaths,
  isStoreSelectorMatch,
  StoreClient,
  storePathsIntersect,
  trackStoreSelector,
  trackStoreUpdater,
  unwrapTrackedValue,
  validateStoreState,
  type Draft,
  type StandardSchemaV1,
  type StoreDefinition,
  type StorePath,
  type StoreSelector,
  type StoreSnapshot,
  type StoreState,
  type StoreStepId,
  type StoreTakeResult,
  type StoreUpdateFromResult,
  type StoreUpdateResult,
  type StoreWaiter,
} from "@yieldstar/core";

type StoreRecord = {
  state: unknown;
  version: number;
};

export class MemoryStoreClient extends StoreClient {
  private stores = new Map<string, StoreRecord>();
  private waiters = new Map<string, StoreWaiter>();
  // Applied-steps ledger: (storeName, storeId, executionId, stepKey) ->
  // serialized committed result. Written in the same synchronous critical
  // section (within the write queue) as the state commit, so a retried
  // workflow step returns the recorded result instead of re-applying.
  private appliedSteps = new Map<string, string>();
  private schedulerClient: SchedulerClient;
  // Serializes writes so concurrent async updaters can't interleave between
  // reading a record's version and writing the incremented version back.
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(params: { schedulerClient: SchedulerClient }) {
    super();
    this.schedulerClient = params.schedulerClient;
  }

  private enqueueWrite<R>(fn: () => Promise<R>): Promise<R> {
    const result = this.writeLock.then(fn, fn);
    this.writeLock = result.catch(() => {});
    return result;
  }

  async getOrCreateStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    initial?:
      | StoreState<Schema>
      | (() => StoreState<Schema> | Promise<StoreState<Schema>>);
  }): Promise<StoreSnapshot<StoreState<Schema>>> {
    const key = this.storeKey(params.definition.name, params.id);
    const existing = this.stores.get(key);

    if (existing) {
      return {
        state: cloneStoreState(existing.state) as StoreState<Schema>,
        version: existing.version,
      };
    }

    if (!params.initial) {
      throw new Error(
        `Store "${params.definition.name}:${params.id}" does not exist`
      );
    }

    const initialValue = params.initial;
    const initial =
      typeof initialValue === "function"
        ? await (
            initialValue as () =>
              | StoreState<Schema>
              | Promise<StoreState<Schema>>
          )()
        : initialValue;
    const state = await validateStoreState(params.definition, initial);

    this.stores.set(key, {
      state: cloneStoreState(state),
      version: 0,
    });

    return {
      state: cloneStoreState(state),
      version: 0,
    };
  }

  async getStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
  }): Promise<StoreSnapshot<StoreState<Schema>>> {
    const record = this.stores.get(
      this.storeKey(params.definition.name, params.id)
    );

    if (!record) {
      throw new Error(
        `Store "${params.definition.name}:${params.id}" does not exist`
      );
    }

    return {
      state: cloneStoreState(record.state) as StoreState<Schema>,
      version: record.version,
    };
  }

  async updateStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
    stepId?: StoreStepId;
  }): Promise<StoreUpdateResult<StoreState<Schema>>> {
    return (await this.updateStoreInternal(params)) as StoreUpdateResult<
      StoreState<Schema>
    >;
  }

  async updateStoreFrom<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    snapshot: StoreSnapshot<StoreState<Schema>>;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
    stepId?: StoreStepId;
  }): Promise<StoreUpdateFromResult<StoreState<Schema>>> {
    const result = await this.updateStoreInternal({
      ...params,
      expectedVersion: params.snapshot.version,
    });
    return "updated" in result ? result : { updated: true, ...result };
  }

  private updateStoreInternal<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
    stepId?: StoreStepId;
    expectedVersion?: number;
  }): Promise<
    | StoreUpdateResult<StoreState<Schema>>
    | Extract<StoreUpdateFromResult<StoreState<Schema>>, { updated: false }>
  > {
    return this.enqueueWrite(async () => {
      const key = this.storeKey(params.definition.name, params.id);

      // Exactly-once: if this workflow step already committed, return the
      // recorded result without re-running the updater.
      if (params.stepId) {
        const applied = this.appliedSteps.get(
          this.appliedStepKey(params.definition.name, params.id, params.stepId)
        );
        if (applied) {
          return JSON.parse(applied) as StoreUpdateResult<StoreState<Schema>>;
        }
      }

      const record = this.stores.get(key);
      if (!record) {
        throw new Error(
          `Store "${params.definition.name}:${params.id}" does not exist`
        );
      }

      if (
        params.expectedVersion !== undefined &&
        record.version !== params.expectedVersion
      ) {
        return {
          updated: false as const,
          expectedVersion: params.expectedVersion,
          actualVersion: record.version,
        };
      }

      const previousState = cloneStoreState(
        record.state
      ) as StoreState<Schema>;
      const draft = cloneStoreState(previousState) as Draft<
        StoreState<Schema>
      >;
      // The updater runs against a write-recording proxy so changed paths
      // are derived from its mutations in O(changes) – the full-state deep
      // diff is only needed when the updater returns a replacement state
      // (or validation returns a transformed copy).
      const tracked = trackStoreUpdater(draft);
      const updated = await params.updater(tracked.draft);
      const returned =
        updated === undefined ? undefined : unwrapTrackedValue(updated);
      const isReplacement = returned !== undefined && returned !== draft;
      const nextState = await validateStoreState(
        params.definition,
        isReplacement ? returned : draft
      );
      const changedPaths =
        !isReplacement && (nextState as unknown) === draft
          ? tracked.writePaths()
          : diffStorePaths(previousState, nextState);
      const version = await this.commitNextState({
        key,
        storeName: params.definition.name,
        storeId: params.id,
        changedPaths,
        nextState,
        previousVersion: record.version,
        // Recorded in the same critical section as the state commit
        appliedStep: params.stepId
          ? {
              key: this.appliedStepKey(
                params.definition.name,
                params.id,
                params.stepId
              ),
              result: JSON.stringify({
                state: nextState,
                previousVersion: record.version,
                version: record.version + 1,
              }),
            }
          : undefined,
      });

      return {
        state: cloneStoreState(nextState),
        previousVersion: record.version,
        version,
      };
    });
  }

  async takeFromStore<Schema extends StandardSchemaV1, R>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    selector: StoreSelector<StoreState<Schema>, R>;
    claim: (
      draft: Draft<StoreState<Schema>>,
      selected: NonNullable<R>
    ) => void;
    stepId?: StoreStepId;
  }): Promise<StoreTakeResult<R>> {
    return this.enqueueWrite(async () => {
      const key = this.storeKey(params.definition.name, params.id);

      // Exactly-once: if this workflow step already committed a claim,
      // return the recorded outcome without re-running selector/claim.
      // Only matched takes are recorded – an unmatched take commits
      // nothing and must be free to re-evaluate on the next wake.
      if (params.stepId) {
        const applied = this.appliedSteps.get(
          this.appliedStepKey(params.definition.name, params.id, params.stepId)
        );
        if (applied) {
          return JSON.parse(applied) as StoreTakeResult<R>;
        }
      }

      const record = this.stores.get(key);
      if (!record) {
        throw new Error(
          `Store "${params.definition.name}:${params.id}" does not exist`
        );
      }

      const previousState = cloneStoreState(
        record.state
      ) as StoreState<Schema>;
      const draft = cloneStoreState(previousState) as Draft<
        StoreState<Schema>
      >;
      // Wrap the draft in a write-recording proxy so the claim's mutations
      // produce the changed paths (O(changes) instead of a full-state diff).
      const tracked = trackStoreUpdater(draft);

      // Run the selector against the mutable draft (through the
      // read-tracking proxy over the recording proxy) so a selected value
      // that is a reference into state observes the claim mutation before
      // it is snapshotted – and so mutations through it are recorded.
      const { result: selectedResult, readPaths } = trackStoreSelector(
        tracked.draft as StoreState<Schema>,
        params.selector
      );

      if (!isStoreSelectorMatch(selectedResult)) {
        return {
          matched: false,
          version: record.version,
          readPaths,
        };
      }

      // Unwraps the selector proxy to the RECORDING proxy, so mutations via
      // the selected reference are captured as write paths.
      const selected = unwrapTrackedValue(selectedResult) as NonNullable<R>;

      assertSynchronousClaim(
        params.claim(tracked.draft as Draft<StoreState<Schema>>, selected)
      );

      const nextState = await validateStoreState(params.definition, draft);
      // Snapshot AFTER the claim ran (and unwrap any tracking proxies) so a
      // selected reference into state reflects the claim mutation.
      const selectedSnapshot = cloneStoreState(selected);
      const changedPaths =
        (nextState as unknown) === draft
          ? tracked.writePaths()
          : diffStorePaths(previousState, nextState);

      const version = await this.commitNextState({
        key,
        storeName: params.definition.name,
        storeId: params.id,
        changedPaths,
        nextState,
        previousVersion: record.version,
        // Recorded in the same critical section as the claim commit
        appliedStep: params.stepId
          ? {
              key: this.appliedStepKey(
                params.definition.name,
                params.id,
                params.stepId
              ),
              result: JSON.stringify({
                matched: true,
                selected: selectedSnapshot,
                version: record.version + 1,
              }),
            }
          : undefined,
      });

      return {
        matched: true,
        selected: selectedSnapshot,
        version,
      };
    });
  }

  /**
   * Commits the next state (version + 1) and wakes waiters matching the
   * changed paths. Must be called while holding the write lock.
   */
  private async commitNextState(params: {
    key: string;
    storeName: string;
    storeId: string;
    changedPaths: StorePath[];
    nextState: unknown;
    previousVersion: number;
    appliedStep?: { key: string; result: string };
  }): Promise<number> {
    const { changedPaths } = params;
    const version = params.previousVersion + 1;

    this.stores.set(params.key, {
      state: cloneStoreState(params.nextState),
      version,
    });

    // Ledger entry lands in the same synchronous section as the state write
    if (params.appliedStep) {
      this.appliedSteps.set(params.appliedStep.key, params.appliedStep.result);
    }

    await this.wakeWaiters({
      storeName: params.storeName,
      storeId: params.storeId,
      version,
      changedPaths,
    });

    return version;
  }

  async listStores<Schema extends StandardSchemaV1>(
    definition: StoreDefinition<Schema>
  ): Promise<string[]> {
    const prefix = `${definition.name}:`;
    const ids: string[] = [];
    for (const key of this.stores.keys()) {
      if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
    return ids.sort();
  }

  async deleteStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
  }): Promise<void> {
    return this.enqueueWrite(async () => {
      const { name } = params.definition;
      this.stores.delete(this.storeKey(name, params.id));
      for (const [key, waiter] of [...this.waiters.entries()]) {
        if (waiter.storeName === name && waiter.storeId === params.id) {
          this.waiters.delete(key);
        }
      }
      const ledgerPrefix = `[${JSON.stringify(name)},${JSON.stringify(params.id)},`;
      for (const key of [...this.appliedSteps.keys()]) {
        if (key.startsWith(ledgerPrefix)) this.appliedSteps.delete(key);
      }
    });
  }

  async registerWaiter(waiter: StoreWaiter): Promise<void> {
    return this.enqueueWrite(async () => {
      const key = this.waiterKey(
        waiter.storeName,
        waiter.storeId,
        waiter.executionId,
        waiter.stepKey
      );
      this.waiters.set(key, cloneStoreState(waiter));

      // Lost-wakeup guard: if an update landed between the caller's getStore
      // and this registration, the version has already advanced. Wake
      // immediately – replay re-evaluates the selector, so a spurious wake
      // is safe.
      const record = this.stores.get(
        this.storeKey(waiter.storeName, waiter.storeId)
      );
      if (record && record.version > waiter.sinceVersion) {
        this.waiters.delete(key);
        await this.schedulerClient.requestWakeUp(waiter.event);
      }
    });
  }

  private async wakeWaiters(params: {
    storeName: string;
    storeId: string;
    version: number;
    changedPaths: readonly (readonly (string | number)[])[];
  }) {
    for (const [key, waiter] of [...this.waiters.entries()]) {
      if (waiter.storeName !== params.storeName) continue;
      if (waiter.storeId !== params.storeId) continue;
      if (waiter.sinceVersion >= params.version) continue;
      if (!storePathsIntersect(waiter.readPaths, [...params.changedPaths])) {
        continue;
      }

      this.waiters.delete(key);
      await this.schedulerClient.requestWakeUp(waiter.event);
    }
  }

  private storeKey(storeName: string, storeId: string) {
    return `${storeName}:${storeId}`;
  }

  private appliedStepKey(
    storeName: string,
    storeId: string,
    stepId: StoreStepId
  ) {
    return JSON.stringify([
      storeName,
      storeId,
      stepId.executionId,
      stepId.stepKey,
    ]);
  }

  private waiterKey(
    storeName: string,
    storeId: string,
    executionId: string,
    stepKey: string
  ) {
    return `${storeName}:${storeId}:${executionId}:${stepKey}`;
  }
}

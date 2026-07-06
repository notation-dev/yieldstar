import type { SchedulerClient } from "@yieldstar/core";
import {
  assertSynchronousClaim,
  cloneStoreState,
  diffStorePaths,
  isStoreSelectorMatch,
  StoreClient,
  storePathsIntersect,
  trackStoreSelector,
  unwrapTrackedValue,
  validateStoreState,
  type Draft,
  type StandardSchemaV1,
  type StoreDefinition,
  type StoreSelector,
  type StoreSnapshot,
  type StoreState,
  type StoreTakeResult,
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
  }): Promise<StoreUpdateResult<StoreState<Schema>>> {
    return this.enqueueWrite(async () => {
      const key = this.storeKey(params.definition.name, params.id);

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
      const updated = await params.updater(draft);
      const nextState = await validateStoreState(
        params.definition,
        updated === undefined ? draft : updated
      );
      const version = await this.commitNextState({
        key,
        storeName: params.definition.name,
        storeId: params.id,
        previousState,
        nextState,
        previousVersion: record.version,
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
  }): Promise<StoreTakeResult<R>> {
    return this.enqueueWrite(async () => {
      const key = this.storeKey(params.definition.name, params.id);

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

      // Run the selector against the mutable draft (through the
      // read-tracking proxy) so a selected value that is a reference into
      // state observes the claim mutation before it is snapshotted.
      const { result: selectedResult, readPaths } = trackStoreSelector(
        draft as StoreState<Schema>,
        params.selector
      );

      if (!isStoreSelectorMatch(selectedResult)) {
        return {
          matched: false,
          version: record.version,
          readPaths,
        };
      }

      const selected = unwrapTrackedValue(selectedResult) as NonNullable<R>;

      assertSynchronousClaim(params.claim(draft, selected));

      const nextState = await validateStoreState(params.definition, draft);
      // Snapshot AFTER the claim ran (and unwrap any tracking proxies) so a
      // selected reference into state reflects the claim mutation.
      const selectedSnapshot = cloneStoreState(selected);

      const version = await this.commitNextState({
        key,
        storeName: params.definition.name,
        storeId: params.id,
        previousState,
        nextState,
        previousVersion: record.version,
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
    previousState: unknown;
    nextState: unknown;
    previousVersion: number;
  }): Promise<number> {
    const changedPaths = diffStorePaths(params.previousState, params.nextState);
    const version = params.previousVersion + 1;

    this.stores.set(params.key, {
      state: cloneStoreState(params.nextState),
      version,
    });

    await this.wakeWaiters({
      storeName: params.storeName,
      storeId: params.storeId,
      version,
      changedPaths,
    });

    return version;
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

  private waiterKey(
    storeName: string,
    storeId: string,
    executionId: string,
    stepKey: string
  ) {
    return `${storeName}:${storeId}:${executionId}:${stepKey}`;
  }
}

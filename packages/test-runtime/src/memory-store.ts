import type { SchedulerClient } from "@yieldstar/core";
import {
  cloneStoreState,
  diffStorePaths,
  StoreClient,
  storePathsIntersect,
  validateStoreState,
  type Draft,
  type StandardSchemaV1,
  type StoreDefinition,
  type StoreSnapshot,
  type StoreState,
  type StoreUpdateResult,
  type StoreWaiter,
} from "@yieldstar/core";

type StoreRecord = {
  state: unknown;
  version: number;
};

export class MemoryStoreClient extends StoreClient {
  private stores = new Map<string, StoreRecord>();
  private updateResults = new Map<string, StoreUpdateResult<any>>();
  private waiters = new Map<string, StoreWaiter>();
  private schedulerClient: SchedulerClient;

  constructor(params: { schedulerClient: SchedulerClient }) {
    super();
    this.schedulerClient = params.schedulerClient;
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
    idempotencyKey?: string;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
  }): Promise<StoreUpdateResult<StoreState<Schema>>> {
    const key = this.storeKey(params.definition.name, params.id);
    const updateKey = params.idempotencyKey
      ? this.updateKey(key, params.idempotencyKey)
      : null;

    if (updateKey) {
      const existing = this.updateResults.get(updateKey);
      if (existing) return cloneStoreState(existing);
    }

    const record = this.stores.get(key);
    if (!record) {
      throw new Error(
        `Store "${params.definition.name}:${params.id}" does not exist`
      );
    }

    const previousState = cloneStoreState(record.state) as StoreState<Schema>;
    const draft = cloneStoreState(previousState) as Draft<StoreState<Schema>>;
    const updated = await params.updater(draft);
    const nextState = await validateStoreState(
      params.definition,
      updated === undefined ? draft : updated
    );
    const changedPaths = diffStorePaths(previousState, nextState);
    const result = {
      state: cloneStoreState(nextState),
      previousVersion: record.version,
      version: record.version + 1,
    };

    this.stores.set(key, {
      state: cloneStoreState(nextState),
      version: result.version,
    });

    if (updateKey) {
      this.updateResults.set(updateKey, cloneStoreState(result));
    }

    await this.wakeWaiters({
      storeName: params.definition.name,
      storeId: params.id,
      version: result.version,
      changedPaths,
    });

    return result;
  }

  async registerWaiter(waiter: StoreWaiter): Promise<void> {
    this.waiters.set(
      this.waiterKey(waiter.storeName, waiter.storeId, waiter.executionId, waiter.stepKey),
      cloneStoreState(waiter)
    );
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

  private updateKey(storeKey: string, idempotencyKey: string) {
    return `${storeKey}:${idempotencyKey}`;
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

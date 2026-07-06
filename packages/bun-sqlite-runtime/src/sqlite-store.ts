import type { Database } from "bun:sqlite";
import type { SchedulerClient, WorkflowEvent } from "@yieldstar/core";
import {
  cloneStoreState,
  diffStorePaths,
  StoreClient,
  storePathsIntersect,
  validateStoreState,
  type Draft,
  type StandardSchemaV1,
  type StoreDefinition,
  type StorePath,
  type StoreSnapshot,
  type StoreState,
  type StoreUpdateResult,
  type StoreWaiter,
} from "@yieldstar/core";

class StoreRow {
  state!: string;
  version!: number;
}

class WaiterRow {
  workflow_id!: string;
  execution_id!: string;
  step_key!: string;
  event!: string;
  store_name!: string;
  store_id!: string;
  since_version!: number;
  read_paths!: string;
}

export class SqliteStoreClient extends StoreClient {
  private db: Database;
  private schedulerClient: SchedulerClient;
  // Serializes all write operations on this client. bun:sqlite uses a single
  // connection, so awaiting an async updater between BEGIN IMMEDIATE and COMMIT
  // would let a second concurrent write issue a nested BEGIN and throw.
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(params: { db: Database; schedulerClient: SchedulerClient }) {
    super();
    this.db = params.db;
    this.schedulerClient = params.schedulerClient;
    this.setupDb();
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
    const existing = this.getStoreRow(params.definition.name, params.id);

    if (existing) {
      return {
        state: JSON.parse(existing.state),
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

    return this.enqueueWrite(async () => {
      this.db.run("BEGIN IMMEDIATE");
      try {
        const existingTx = this.getStoreRow(params.definition.name, params.id);
        if (existingTx) {
          this.db.run("COMMIT");
          return {
            state: JSON.parse(existingTx.state),
            version: existingTx.version,
          };
        }

        this.db
          .query(
            `INSERT INTO stores (store_name, store_id, version, state)
             VALUES ($storeName, $storeId, 0, $state)`
          )
          .run({
            $storeName: params.definition.name,
            $storeId: params.id,
            $state: JSON.stringify(state),
          });
        this.db.run("COMMIT");
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }

      return {
        state: cloneStoreState(state),
        version: 0,
      };
    });
  }

  async getStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
  }): Promise<StoreSnapshot<StoreState<Schema>>> {
    const row = this.getStoreRow(params.definition.name, params.id);

    if (!row) {
      throw new Error(
        `Store "${params.definition.name}:${params.id}" does not exist`
      );
    }

    return {
      state: JSON.parse(row.state),
      version: row.version,
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
      let result: StoreUpdateResult<StoreState<Schema>>;
      let waitersToWake: MatchedWaiter[] = [];

      this.db.run("BEGIN IMMEDIATE");

      try {
        const row = this.getStoreRow(params.definition.name, params.id);
        if (!row) {
          throw new Error(
            `Store "${params.definition.name}:${params.id}" does not exist`
          );
        }

        const previousState = JSON.parse(row.state) as StoreState<Schema>;
        const draft = cloneStoreState(previousState) as Draft<
          StoreState<Schema>
        >;
        const updated = await params.updater(draft);
        const nextState = await validateStoreState(
          params.definition,
          updated === undefined ? draft : updated
        );
        const changedPaths = diffStorePaths(previousState, nextState);
        const version = row.version + 1;

        this.db
          .query(
            `UPDATE stores
             SET version = $version, state = $state
             WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run({
            $storeName: params.definition.name,
            $storeId: params.id,
            $version: version,
            $state: JSON.stringify(nextState),
          });

        waitersToWake = this.selectMatchingWaiters({
          storeName: params.definition.name,
          storeId: params.id,
          version,
          changedPaths,
        });

        result = {
          state: cloneStoreState(nextState),
          previousVersion: row.version,
          version,
        };

        this.db.run("COMMIT");
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }

      await this.wakeWaiters({
        storeName: params.definition.name,
        storeId: params.id,
        waiters: waitersToWake,
      });

      return result;
    });
  }

  /**
   * Wake durability: the waiter row is only deleted after the wake has
   * been enqueued. If the process crashes between COMMIT and enqueue, the
   * waiter survives and is woken by the next matching update. This may
   * produce a duplicate wake, which is safe – replay re-evaluates the
   * selector and re-registers if it still doesn't match.
   */
  private async wakeWaiters(params: {
    storeName: string;
    storeId: string;
    waiters: MatchedWaiter[];
  }) {
    for (const waiter of params.waiters) {
      await this.schedulerClient.requestWakeUp(waiter.event);
      this.deleteWaiterRow({
        storeName: params.storeName,
        storeId: params.storeId,
        executionId: waiter.executionId,
        stepKey: waiter.stepKey,
      });
    }
  }

  async registerWaiter(waiter: StoreWaiter): Promise<void> {
    return this.enqueueWrite(async () => {
      let versionAdvanced = false;

      this.db.run("BEGIN IMMEDIATE");
      try {
        this.db
          .query(
            `INSERT INTO store_waiters
               (workflow_id, execution_id, step_key, event, store_name, store_id, since_version, read_paths)
             VALUES
               ($workflowId, $executionId, $stepKey, $event, $storeName, $storeId, $sinceVersion, $readPaths)
             ON CONFLICT(store_name, store_id, execution_id, step_key)
             DO UPDATE SET
               event = excluded.event,
               since_version = excluded.since_version,
               read_paths = excluded.read_paths`
          )
          .run({
            $workflowId: waiter.workflowId,
            $executionId: waiter.executionId,
            $stepKey: waiter.stepKey,
            $event: JSON.stringify(serializeEvent(waiter.event)),
            $storeName: waiter.storeName,
            $storeId: waiter.storeId,
            $sinceVersion: waiter.sinceVersion,
            $readPaths: JSON.stringify(waiter.readPaths),
          });

        // Lost-wakeup guard: if an update committed between the caller's
        // getStore and this registration, the version has already advanced
        // past sinceVersion and no future update is guaranteed. Trigger an
        // immediate wake – the replay re-evaluates the selector, so a
        // spurious wake is safe.
        const row = this.getStoreRow(waiter.storeName, waiter.storeId);
        if (row && row.version > waiter.sinceVersion) {
          versionAdvanced = true;
        }

        this.db.run("COMMIT");
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }

      if (versionAdvanced) {
        await this.schedulerClient.requestWakeUp(waiter.event);
        this.deleteWaiterRow({
          storeName: waiter.storeName,
          storeId: waiter.storeId,
          executionId: waiter.executionId,
          stepKey: waiter.stepKey,
        });
      }
    });
  }

  private setupDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS stores (
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (store_name, store_id)
      );

      CREATE TABLE IF NOT EXISTS store_waiters (
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        event TEXT NOT NULL,
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        since_version INTEGER NOT NULL,
        read_paths TEXT NOT NULL,
        PRIMARY KEY (store_name, store_id, execution_id, step_key)
      );
    `);
  }

  private getStoreRow(storeName: string, storeId: string) {
    return this.db
      .query(
        `SELECT state, version FROM stores
         WHERE store_name = $storeName AND store_id = $storeId`
      )
      .as(StoreRow)
      .get({
        $storeName: storeName,
        $storeId: storeId,
      });
  }

  private selectMatchingWaiters(params: {
    storeName: string;
    storeId: string;
    version: number;
    changedPaths: StorePath[];
  }): MatchedWaiter[] {
    const waiters: MatchedWaiter[] = [];
    const rows = this.db
      .query(
        `SELECT * FROM store_waiters
         WHERE store_name = $storeName AND store_id = $storeId`
      )
      .as(WaiterRow)
      .all({
        $storeName: params.storeName,
        $storeId: params.storeId,
      });

    for (const row of rows) {
      if (row.since_version >= params.version) continue;

      const readPaths = JSON.parse(row.read_paths) as StorePath[];
      if (!storePathsIntersect(readPaths, params.changedPaths)) continue;

      waiters.push({
        executionId: row.execution_id,
        stepKey: row.step_key,
        event: deserializeEvent(JSON.parse(row.event)),
      });
    }

    return waiters;
  }

  private deleteWaiterRow(params: {
    storeName: string;
    storeId: string;
    executionId: string;
    stepKey: string;
  }) {
    this.db
      .query(
        `DELETE FROM store_waiters
         WHERE store_name = $storeName
           AND store_id = $storeId
           AND execution_id = $executionId
           AND step_key = $stepKey`
      )
      .run({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $executionId: params.executionId,
        $stepKey: params.stepKey,
      });
  }
}

type MatchedWaiter = {
  executionId: string;
  stepKey: string;
  event: WorkflowEvent;
};

function serializeEvent(event: WorkflowEvent) {
  return {
    workflowId: event.workflowId,
    executionId: event.executionId,
    params: event.params,
    context:
      event.context instanceof Map
        ? [...event.context.entries()]
        : event.context
          ? Object.entries(event.context as any)
          : [],
  };
}

function deserializeEvent(event: any): WorkflowEvent {
  return {
    workflowId: event.workflowId,
    executionId: event.executionId,
    params: event.params,
    context: new Map(event.context ?? []),
  };
}

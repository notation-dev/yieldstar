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

  constructor(params: { db: Database; schedulerClient: SchedulerClient }) {
    super();
    this.db = params.db;
    this.schedulerClient = params.schedulerClient;
    this.setupDb();
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
    let result: StoreUpdateResult<StoreState<Schema>>;
    let eventsToWake: WorkflowEvent[] = [];

    this.db.run("BEGIN IMMEDIATE");

    try {
      const row = this.getStoreRow(params.definition.name, params.id);
      if (!row) {
        throw new Error(
          `Store "${params.definition.name}:${params.id}" does not exist`
        );
      }

      const previousState = JSON.parse(row.state) as StoreState<Schema>;
      const draft = cloneStoreState(previousState) as Draft<StoreState<Schema>>;
      const updated = await params.updater(draft);
      const nextState = await validateStoreState(
        params.definition,
        updated === undefined ? draft : updated
      );
      const changedPaths = diffStorePaths(previousState, nextState);

      result = {
        state: cloneStoreState(nextState),
        previousVersion: row.version,
        version: row.version + 1,
      };

      this.db
        .query(
          `UPDATE stores
           SET version = $version, state = $state
           WHERE store_name = $storeName AND store_id = $storeId`
        )
        .run({
          $storeName: params.definition.name,
          $storeId: params.id,
          $version: result.version,
          $state: JSON.stringify(nextState),
        });

      eventsToWake = this.deleteMatchingWaiters({
        storeName: params.definition.name,
        storeId: params.id,
        version: result.version,
        changedPaths,
      });

      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }

    for (const event of eventsToWake) {
      await this.schedulerClient.requestWakeUp(event);
    }

    return result;
  }

  async registerWaiter(waiter: StoreWaiter): Promise<void> {
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

  private deleteMatchingWaiters(params: {
    storeName: string;
    storeId: string;
    version: number;
    changedPaths: StorePath[];
  }): WorkflowEvent[] {
    const events: WorkflowEvent[] = [];
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
          $executionId: row.execution_id,
          $stepKey: row.step_key,
        });

      events.push(deserializeEvent(JSON.parse(row.event)));
    }

    return events;
  }
}

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

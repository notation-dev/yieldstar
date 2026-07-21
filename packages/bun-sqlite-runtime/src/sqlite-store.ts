import type { Database } from "bun:sqlite";
import type { SchedulerClient, WorkflowEvent } from "@yieldstar/core";
import {
  cloneStoreState,
  CasStoreClient,
  storePathsIntersect,
  validateStoreState,
  type StandardSchemaV1,
  type StoreDefinition,
  type StoreDeleteFromResult,
  type StorePath,
  type StoreSnapshot,
  type StoreState,
  type StoreStepId,
  type StoreWaiter,
  type StoreMutation,
  type StoreMutationCommitResult,
} from "@yieldstar/core";

class StoreRow {
  instance_id!: string;
  state!: string;
  version!: number;
}

class AppliedStepRow {
  result!: string;
}

class StoreIdRow {
  store_id!: string;
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

class WakeOutboxRow {
  store_name!: string;
  store_id!: string;
  execution_id!: string;
  step_key!: string;
  event!: string | null;
  since_version!: number | null;
}

export class SqliteStoreClient extends CasStoreClient {
  private db: Database;
  private schedulerClient: SchedulerClient;
  // Serializes write transactions on this single bun:sqlite connection.
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(params: { db: Database; schedulerClient: SchedulerClient }) {
    super();
    this.db = params.db;
    this.schedulerClient = params.schedulerClient;
    this.setupDb();
    // A previous process may have committed a store mutation and its wake
    // intents before it could enqueue them. Delivery is idempotent, so every
    // client startup can safely resume the durable outbox.
    void this.enqueueWrite(() => this.drainWakeOutboxBestEffort());
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
        instanceId: existing.instance_id,
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
            instanceId: existingTx.instance_id,
            version: existingTx.version,
          };
        }

        const instanceId = Bun.randomUUIDv7();
        this.db
          .query(
            `INSERT INTO stores (instance_id, store_name, store_id, version, state)
             VALUES ($instanceId, $storeName, $storeId, 0, $state)`
          )
          .run({
            $instanceId: instanceId,
            $storeName: params.definition.name,
            $storeId: params.id,
            $state: JSON.stringify(state),
          });
        this.db.run("COMMIT");
        return {
          state: cloneStoreState(state),
          instanceId,
          version: 0,
        };
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }

      throw new Error("Store creation transaction returned unexpectedly");
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
      instanceId: row.instance_id,
      version: row.version,
    };
  }

  protected async getAppliedStoreStep(params: {
    definition: StoreDefinition;
    id: string;
    stepId: StoreStepId;
  }): Promise<{ result: unknown } | undefined> {
    const row = this.getAppliedStepRow({
      storeName: params.definition.name,
      storeId: params.id,
      stepId: params.stepId,
    });
    return row ? { result: JSON.parse(row.result) } : undefined;
  }

  protected commitStoreMutation(
    mutation: StoreMutation
  ): Promise<StoreMutationCommitResult> {
    return this.enqueueWrite(async () => {
      this.db.run("BEGIN IMMEDIATE");
      try {
        if (mutation.stepId) {
          const applied = this.getAppliedStepRow({
            storeName: mutation.definition.name,
            storeId: mutation.id,
            stepId: mutation.stepId,
          });
          if (applied) {
            this.db.run("COMMIT");
            return {
              status: "already-applied",
              result: JSON.parse(applied.result),
            };
          }
        }

        const row = this.getStoreRow(mutation.definition.name, mutation.id);
        if (!row) {
          throw new Error(
            `Store "${mutation.definition.name}:${mutation.id}" does not exist`
          );
        }
        if (
          row.instance_id !== mutation.expected.instanceId ||
          row.version !== mutation.expected.version
        ) {
          this.db.run("COMMIT");
          return {
            status: "conflict",
            snapshot: {
              state: JSON.parse(row.state),
              instanceId: row.instance_id,
              version: row.version,
            },
          };
        }

        const version = mutation.expected.version + 1;
        const changed = this.db
          .query(
            `UPDATE stores
             SET version = $version, state = $state
             WHERE instance_id = $instanceId AND version = $expectedVersion`
          )
          .run({
            $instanceId: mutation.expected.instanceId,
            $expectedVersion: mutation.expected.version,
            $version: version,
            $state: JSON.stringify(mutation.nextState),
          });
        if (changed.changes !== 1) {
          throw new Error("Store changed during its mutation transaction");
        }

        if (mutation.stepId) {
          this.insertAppliedStepRow({
            storeName: mutation.definition.name,
            storeId: mutation.id,
            stepId: mutation.stepId,
            result: JSON.stringify(mutation.result),
          });
        }

        const waiters = this.selectMatchingWaiters({
          storeName: mutation.definition.name,
          storeId: mutation.id,
          version,
          changedPaths: mutation.changedPaths,
        });
        for (const waiter of waiters) {
          this.insertWakeOutboxRow({
            storeName: mutation.definition.name,
            storeId: mutation.id,
            executionId: waiter.executionId,
            stepKey: waiter.stepKey,
          });
        }

        this.db.run("COMMIT");
      } catch (error) {
        this.db.run("ROLLBACK");
        throw error;
      }

      // Wake delivery is deliberately outside the mutation result. Once the
      // outbox intent commits, scheduler failure must not poison later store
      // operations; another operation or client startup will retry it.
      await this.drainWakeOutboxBestEffort();
      return { status: "committed" };
    });
  }

  async listStores<Schema extends StandardSchemaV1>(
    definition: StoreDefinition<Schema>
  ): Promise<string[]> {
    const rows = this.db
      .query(
        `SELECT store_id FROM stores
         WHERE store_name = $storeName
         ORDER BY store_id ASC`
      )
      .as(StoreIdRow)
      .all({ $storeName: definition.name });
    return rows.map((row) => row.store_id);
  }

  async deleteStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
  }): Promise<void> {
    return this.enqueueWrite(async () => {
      const bindings = {
        $storeName: params.definition.name,
        $storeId: params.id,
      };
      this.db.run("BEGIN IMMEDIATE");
      try {
        this.db
          .query(
            `DELETE FROM stores WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db
          .query(
            `DELETE FROM store_waiters WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db
          .query(
            `DELETE FROM store_wake_outbox WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db.run("COMMIT");
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }
    });
  }

  async deleteStoreFrom(params: {
    definition: StoreDefinition;
    id: string;
    snapshot: StoreSnapshot<unknown>;
    stepId?: StoreStepId;
  }): Promise<StoreDeleteFromResult> {
    return this.enqueueWrite(async () => {
      const bindings = {
        $storeName: params.definition.name,
        $storeId: params.id,
      };
      this.db.run("BEGIN IMMEDIATE");
      try {
        if (params.stepId) {
          const applied = this.getAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
          });
          if (applied) {
            this.db.run("COMMIT");
            return JSON.parse(applied.result) as StoreDeleteFromResult;
          }
        }

        this.assertSnapshotHasInstanceId(params.snapshot);

        const row = this.getStoreRow(params.definition.name, params.id);
        if (!row) {
          this.db.run("COMMIT");
          return {
            deleted: false,
            reason: "not-found",
            expectedInstanceId: params.snapshot.instanceId,
            expectedVersion: params.snapshot.version,
          };
        }
        if (
          row.instance_id !== params.snapshot.instanceId ||
          row.version !== params.snapshot.version
        ) {
          this.db.run("COMMIT");
          return {
            deleted: false,
            reason: "conflict",
            expectedInstanceId: params.snapshot.instanceId,
            actualInstanceId: row.instance_id,
            expectedVersion: params.snapshot.version,
            actualVersion: row.version,
          };
        }

        this.db
          .query(
            `DELETE FROM store_waiters WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db
          .query(
            `DELETE FROM store_wake_outbox WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db
          .query(`DELETE FROM stores WHERE instance_id = $instanceId`)
          .run({ $instanceId: row.instance_id });
        const result = { deleted: true as const };
        if (params.stepId) {
          this.insertAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
            result: JSON.stringify(result),
          });
        }
        this.db.run("COMMIT");
        return result;
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }
    });
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
        if (
          !row ||
          row.instance_id !== waiter.instanceId ||
          row.version > waiter.sinceVersion
        ) {
          versionAdvanced = true;
          this.insertWakeOutboxRow({
            storeName: waiter.storeName,
            storeId: waiter.storeId,
            executionId: waiter.executionId,
            stepKey: waiter.stepKey,
          });
        }

        this.db.run("COMMIT");
      } catch (err) {
        this.db.run("ROLLBACK");
        throw err;
      }

      if (versionAdvanced) {
        await this.drainWakeOutboxBestEffort();
      }
    });
  }

  private setupDb() {
    this.createStoresTable();

    this.db.run(`
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

      CREATE TABLE IF NOT EXISTS store_applied_steps (
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY (store_name, store_id, execution_id, step_key)
      );

      CREATE TABLE IF NOT EXISTS store_wake_outbox (
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        PRIMARY KEY (store_name, store_id, execution_id, step_key)
      );
    `);
  }

  private createStoresTable() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS stores (
        instance_id TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state TEXT NOT NULL,
        UNIQUE (store_name, store_id)
      )
    `);
  }

  private getAppliedStepRow(params: {
    storeName: string;
    storeId: string;
    stepId: StoreStepId;
  }) {
    return this.db
      .query(
        `SELECT result FROM store_applied_steps
         WHERE store_name = $storeName
           AND store_id = $storeId
           AND execution_id = $executionId
           AND step_key = $stepKey`
      )
      .as(AppliedStepRow)
      .get({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $executionId: params.stepId.executionId,
        $stepKey: params.stepId.stepKey,
      });
  }

  private insertAppliedStepRow(params: {
    storeName: string;
    storeId: string;
    stepId: StoreStepId;
    result: string;
  }) {
    this.db
      .query(
        `INSERT INTO store_applied_steps
           (store_name, store_id, execution_id, step_key, result)
         VALUES
           ($storeName, $storeId, $executionId, $stepKey, $result)`
      )
      .run({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $executionId: params.stepId.executionId,
        $stepKey: params.stepId.stepKey,
        $result: params.result,
      });
  }

  private getStoreRow(storeName: string, storeId: string) {
    return this.db
      .query(
        `SELECT instance_id, state, version FROM stores
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
    sinceVersion?: number;
  }) {
    this.db
      .query(
        `DELETE FROM store_waiters
         WHERE store_name = $storeName
           AND store_id = $storeId
           AND execution_id = $executionId
           AND step_key = $stepKey
           AND ($sinceVersion IS NULL OR since_version = $sinceVersion)`
      )
      .run({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $executionId: params.executionId,
        $stepKey: params.stepKey,
        $sinceVersion: params.sinceVersion ?? null,
      });
  }

  private insertWakeOutboxRow(params: {
    storeName: string;
    storeId: string;
    executionId: string;
    stepKey: string;
  }) {
    this.db
      .query(
        `INSERT OR IGNORE INTO store_wake_outbox
           (store_name, store_id, execution_id, step_key)
         VALUES ($storeName, $storeId, $executionId, $stepKey)`
      )
      .run({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $executionId: params.executionId,
        $stepKey: params.stepKey,
      });
  }

  private async drainWakeOutbox(): Promise<void> {
    const rows = this.db
      .query(
        `SELECT
           o.store_name,
           o.store_id,
           o.execution_id,
           o.step_key,
           w.event,
           w.since_version
         FROM store_wake_outbox o
         LEFT JOIN store_waiters w
           ON w.store_name = o.store_name
          AND w.store_id = o.store_id
          AND w.execution_id = o.execution_id
          AND w.step_key = o.step_key
         ORDER BY o.store_name, o.store_id, o.execution_id, o.step_key`
      )
      .as(WakeOutboxRow)
      .all();

    for (const row of rows) {
      try {
        if (row.event !== null) {
          await this.schedulerClient.requestWakeUp(
            deserializeEvent(JSON.parse(row.event))
          );
          this.deleteWaiterRow({
            storeName: row.store_name,
            storeId: row.store_id,
            executionId: row.execution_id,
            stepKey: row.step_key,
            sinceVersion: row.since_version ?? undefined,
          });
        }

        this.db
          .query(
            `DELETE FROM store_wake_outbox
             WHERE store_name = $storeName
               AND store_id = $storeId
               AND execution_id = $executionId
               AND step_key = $stepKey`
          )
          .run({
            $storeName: row.store_name,
            $storeId: row.store_id,
            $executionId: row.execution_id,
            $stepKey: row.step_key,
          });
      } catch (error) {
        // Leave only this row pending. A malformed event or event-specific
        // scheduler failure must not prevent later wake intents from draining.
        console.error("Failed to deliver pending store wake", error);
      }
    }
  }

  private async drainWakeOutboxBestEffort(): Promise<void> {
    try {
      await this.drainWakeOutbox();
    } catch (error) {
      // Query/database failures also stay outside store-operation success.
      console.error("Failed to drain pending store wakes", error);
    }
  }

  private assertSnapshotHasInstanceId(snapshot: { instanceId?: string }) {
    if (!snapshot.instanceId) {
      throw new Error(
        "Store snapshot is missing instanceId; read a fresh snapshot"
      );
    }
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

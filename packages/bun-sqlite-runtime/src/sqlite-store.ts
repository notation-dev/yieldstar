import type { Database } from "bun:sqlite";
import type { SchedulerClient, WorkflowEvent } from "@yieldstar/core";
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

class StoreRow {
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
      let result: StoreUpdateResult<StoreState<Schema>>;
      let waitersToWake: MatchedWaiter[] = [];

      this.db.run("BEGIN IMMEDIATE");

      try {
        // Exactly-once: if this workflow step already committed, return the
        // recorded result without re-running the updater.
        if (params.stepId) {
          const applied = this.getAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
          });
          if (applied) {
            this.db.run("COMMIT");
            return JSON.parse(applied.result) as StoreUpdateResult<
              StoreState<Schema>
            >;
          }
        }

        const row = this.getStoreRow(params.definition.name, params.id);
        if (!row) {
          throw new Error(
            `Store "${params.definition.name}:${params.id}" does not exist`
          );
        }

        if (
          params.expectedVersion !== undefined &&
          row.version !== params.expectedVersion
        ) {
          this.db.run("COMMIT");
          return {
            updated: false as const,
            expectedVersion: params.expectedVersion,
            actualVersion: row.version,
          };
        }

        const previousState = JSON.parse(row.state) as StoreState<Schema>;
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
        const committed = this.commitNextState({
          storeName: params.definition.name,
          storeId: params.id,
          changedPaths,
          nextState,
          previousVersion: row.version,
        });
        waitersToWake = committed.waitersToWake;

        result = {
          state: cloneStoreState(nextState),
          previousVersion: row.version,
          version: committed.version,
        };

        // Ledger row commits atomically with the state update
        if (params.stepId) {
          this.insertAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
            result: JSON.stringify({
              state: nextState,
              previousVersion: row.version,
              version: committed.version,
            }),
          });
        }

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
      let result: StoreTakeResult<R>;
      let waitersToWake: MatchedWaiter[] = [];

      this.db.run("BEGIN IMMEDIATE");

      try {
        // Exactly-once: if this workflow step already committed a claim,
        // return the recorded outcome without re-running selector/claim.
        // Only matched takes are recorded – an unmatched take commits
        // nothing and must be free to re-evaluate on the next wake.
        if (params.stepId) {
          const applied = this.getAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
          });
          if (applied) {
            this.db.run("COMMIT");
            return JSON.parse(applied.result) as StoreTakeResult<R>;
          }
        }

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
          this.db.run("COMMIT");
          return {
            matched: false,
            version: row.version,
            readPaths,
          };
        }

        // Unwraps the selector proxy to the RECORDING proxy, so mutations
        // via the selected reference are captured as write paths.
        const selected = unwrapTrackedValue(
          selectedResult
        ) as NonNullable<R>;

        assertSynchronousClaim(
          params.claim(tracked.draft as Draft<StoreState<Schema>>, selected)
        );

        const nextState = await validateStoreState(params.definition, draft);
        // Snapshot AFTER the claim ran (and unwrap any tracking proxies) so
        // a selected reference into state reflects the claim mutation.
        const selectedSnapshot = cloneStoreState(selected);
        const changedPaths =
          (nextState as unknown) === draft
            ? tracked.writePaths()
            : diffStorePaths(previousState, nextState);

        const committed = this.commitNextState({
          storeName: params.definition.name,
          storeId: params.id,
          changedPaths,
          nextState,
          previousVersion: row.version,
        });
        waitersToWake = committed.waitersToWake;

        result = {
          matched: true,
          selected: selectedSnapshot,
          version: committed.version,
        };

        // Ledger row commits atomically with the claim
        if (params.stepId) {
          this.insertAppliedStepRow({
            storeName: params.definition.name,
            storeId: params.id,
            stepId: params.stepId,
            result: JSON.stringify(result),
          });
        }

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
   * Writes the next state (version + 1) and collects the waiters woken by
   * the changed paths. Must be called inside an open transaction.
   */
  private commitNextState(params: {
    storeName: string;
    storeId: string;
    changedPaths: StorePath[];
    nextState: unknown;
    previousVersion: number;
  }): { version: number; waitersToWake: MatchedWaiter[] } {
    const { changedPaths } = params;
    const version = params.previousVersion + 1;

    this.db
      .query(
        `UPDATE stores
         SET version = $version, state = $state
         WHERE store_name = $storeName AND store_id = $storeId`
      )
      .run({
        $storeName: params.storeName,
        $storeId: params.storeId,
        $version: version,
        $state: JSON.stringify(params.nextState),
      });

    const waitersToWake = this.selectMatchingWaiters({
      storeName: params.storeName,
      storeId: params.storeId,
      version,
      changedPaths,
    });

    return { version, waitersToWake };
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
            `DELETE FROM store_applied_steps WHERE store_name = $storeName AND store_id = $storeId`
          )
          .run(bindings);
        this.db.run("COMMIT");
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

      CREATE TABLE IF NOT EXISTS store_applied_steps (
        store_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY (store_name, store_id, execution_id, step_key)
      );
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

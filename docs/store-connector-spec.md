# YieldStar store connector conformance specification

Status: publishable specification for the YieldStar 0.5 connector protocol.

This document defines the observable contract for a YieldStar store connector. The words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are normative.

## Qualification

A connector is qualified by running `registerStoreClientConformance` from `@yieldstar/store-conformance` against a factory that creates a clean backend. Passing the base suite qualifies the connector for process-local use.

A factory that returns `createPeer` declares that independent clients can concurrently access the same backend. The shared-client checks then become REQUIRED. A factory that returns `restart` declares durable storage and wake recovery across client or process failure. The durable-delivery checks then become REQUIRED.

Qualification applies to synchronous, transaction-capable drivers. Async remote drivers such as Turso and batch-only backends such as D1 require future protocol extensions and are not qualified by this version.

## Connector surface

Connector authors SHOULD extend `CasStoreClient`. They implement the ordinary `StoreClient` persistence methods plus the two protected CAS primitives:

- `getAppliedStoreStep` reads a previously committed step receipt.
- `commitStoreMutation` compares the expected instance and version, commits the next state, records an optional step receipt, and records any wake obligations as one atomic action.

A connector MUST treat `(definition.name, id)` as a logical store key. A physical store instance has an opaque, non-empty `instanceId` and a monotonically increasing integer `version`, beginning at zero. Deleting and recreating a logical store MUST produce a new `instanceId` and reset its version to zero. Store states and returned results MUST be detached values: changing a value returned to or supplied by a caller MUST NOT mutate persisted state.

`listStores` MUST return the logical IDs for one definition name in ascending order. `deleteStore` MUST be idempotent and MUST remove waiters and pending wakes for the deleted physical instance. It MUST NOT allow an old pending wake to transfer to a recreated instance.

## Compare-and-swap mutations

`commitStoreMutation` MUST linearize on both `expected.instanceId` and `expected.version`.

- If both match, the connector MUST store `nextState`, increment the version by exactly one, atomically record the optional receipt and matching wake obligations, and return `committed`.
- If either differs, it MUST make no change and return `conflict` with a current detached snapshot.
- If the optional step receipt already exists, it MUST make no change and return `already-applied` with the recorded result. Receipt lookup takes precedence over the CAS comparison.

Concurrent successful mutations against one physical instance MUST form a total order with contiguous versions. `CasStoreClient` retries a normal update or matched take after a conflict. Consequently, updaters, selectors, and claims MUST be synchronous, deterministic, and side-effect-free: they MAY execute more than once before one public operation returns. Connectors MUST NOT hold a storage transaction while application callbacks execute.

`updateStoreFrom` and `deleteStoreFrom` do not retry a new operation after a conflict. Their callbacks can still have run before a racing conflict is observed. Missing or stale instance IDs MUST never affect a recreated physical store.

## Exactly-once step receipts

A `StoreStepId` is scoped by `(storeName, storeId, executionId, stepKey)`. For a mutating update, a matched take, or a successful conditional delete with a step ID, the connector MUST commit the operation result receipt atomically with the mutation. A retry with the same identity MUST return the recorded result verbatim without executing application callbacks or changing the store version.

Receipt uniqueness MUST hold under concurrent duplicate submissions: at most one mutation commits and every submitter observes the same recorded result. Receipts are ledger entries for a logical store key, not a physical instance, and MUST remain authoritative after deletion and recreation. This prevents a retried workflow step from affecting a new instance.

An unmatched take performs no mutation and MUST NOT record a receipt. It returns the current `instanceId`, `version`, and tracked read paths so replay can re-evaluate the selector after a wake.

Calls without a step ID are not exactly-once. If their outcome is uncertain, callers must read and reconcile rather than blindly retry.

## Waiters and wake delivery

A waiter records its workflow event, physical `instanceId`, observed `sinceVersion`, and selector read paths. Registration and commits for one logical store MUST be linearizable with these outcomes:

- If registration linearizes before a later intersecting mutation, that mutation creates a wake obligation.
- If a mutation or instance replacement linearizes before registration and makes the supplied observation stale, registration creates an immediate wake obligation.

This coordination closes the lost-wakeup gap between an unmatched take and waiter registration. A connector MAY conservatively wake when it cannot prove that a stale change was unrelated. Spurious wakes are safe because workflow replay re-evaluates the selector; missed wakes are not safe.

For a current waiter, a commit creates a wake obligation only when the new version is greater than `sinceVersion` and a changed path intersects a read path by prefix. Replacement updates and array mutations MUST report enough changed paths to preserve this rule. Over-reporting paths is allowed; under-reporting is not.

The wake obligation MUST be atomic with the state mutation or stale registration that creates it. After that atomic action commits, scheduler failure MUST NOT roll back or poison the store operation. Delivery MUST be retried until `SchedulerClient.requestWakeUp` succeeds, including after a durable connector is reopened following a crash. One failing delivery MUST NOT block unrelated deliveries.

Delivery is at-least-once, not exactly-once. A process can crash after the scheduler accepts a wake and before the connector records success, so the scheduler and workflow replay path MUST tolerate duplicates. After successful delivery, the connector MUST consume the specific waiter generation that produced the wake. It MUST NOT delete a newer registration written under the same waiter key while delivery was in flight.

A durable transactional outbox keyed by store, execution, and step is the recommended implementation, but it is not part of the protocol. Any design satisfying atomic intent, crash recovery, retry isolation, and generation-safe acknowledgement conforms.

## Failure boundaries

Once a state mutation and its wake obligations commit, wake transport errors SHOULD be handled as best-effort delivery failures rather than changing the mutation result. A rejected public promise does not prove that no commit occurred. Exactly-once recovery is available only by repeating the call with the same step ID; otherwise the caller must read and reconcile.

Validation failures and asynchronous updater or claim callbacks MUST leave state, receipts, and wake obligations unchanged.

## Running the suite

See [`@yieldstar/store-conformance`](../packages/store-conformance/README.md) for the factory API and a minimal Vitest example. The YieldStar CI runs the same artifact against the in-memory connector and the Bun and Node SQLite connectors. SQLite declares shared-client and durable-restart capabilities; the in-memory connector qualifies only for process-local use.

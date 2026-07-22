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

A connector MUST treat `(definition.name, id)` as a logical store key. A physical store instance has an opaque, non-empty, UUID-compatible lowercase hexadecimal-and-hyphen `instanceId` and a monotonically increasing integer `version`, beginning at zero. Deleting and recreating a logical store MUST produce a new `instanceId` and reset its version to zero. Store states and returned results MUST be detached values: changing a value returned to or supplied by a caller MUST NOT mutate persisted state.

`getStore` MUST return the current detached snapshot and MUST reject when the logical store does not exist. `getOrCreateStore` MUST return the existing snapshot when present; otherwise it MUST require and schema-validate `initial`, create one version-zero instance, and return it. A shared-client backend MUST serialize concurrent creation so every caller observes the same created instance.

`listStores` MUST return the logical IDs for one definition name in deterministic ascending text order; qualification verifies ordinal ordering for ASCII IDs. `deleteStore` MUST be idempotent. Both `deleteStore` and a successful `deleteStoreFrom` MUST remove waiters and pending wakes for the deleted physical instance, and an old pending wake MUST NOT transfer to a recreated instance. Deletion silently drops those waiters without requesting wake-up.

## Compare-and-swap mutations

`commitStoreMutation` MUST linearize on both `expected.instanceId` and `expected.version`.

- If both match, the connector MUST store `nextState`, increment the version by exactly one, atomically record the optional receipt and matching wake obligations, and return `committed`.
- If either differs while the logical store still exists, it MUST make no change and return `conflict` with a current detached snapshot.
- If the expected physical instance was deleted and no current instance exists, it MUST make no change and reject with a store-not-found error. `StoreMutationCommitResult` has no separate deleted outcome in this protocol version.
- If the optional step receipt already exists, it MUST make no change and return `already-applied` with the recorded result. Receipt lookup takes precedence over the CAS comparison.

Concurrent successful mutations against one physical instance MUST form a total order with contiguous versions. `CasStoreClient` retries a normal update or matched take after a conflict. Consequently, updaters, selectors, and claims MUST be synchronous, deterministic, and side-effect-free: they MAY execute more than once before one public operation returns. Connectors MUST NOT hold a storage transaction while application callbacks execute.

`updateStoreFrom` and `deleteStoreFrom` do not retry a new operation after a conflict. Their callbacks can still have run before a racing conflict is observed. Missing or stale instance IDs MUST never affect a recreated physical store.

## Exactly-once step receipts

A `StoreStepId` is scoped by `(storeName, storeId, executionId, stepKey)`. For a mutating update, a matched take, or a successful conditional delete with a step ID, the connector MUST commit the operation result receipt atomically with the mutation. A retry with the same identity MUST return the recorded result verbatim without executing application callbacks or changing the store version.

Receipt lookup precedes snapshot existence, instance, and version checks for `updateStoreFrom` and `deleteStoreFrom` as well as for `commitStoreMutation`. Replaying a successful conditional delete therefore returns its receipt even after the logical store has been recreated.

Receipt uniqueness MUST hold under concurrent duplicate submissions: at most one mutation commits and every submitter observes the same recorded result. Receipts are ledger entries for a logical store key, not a physical instance, and MUST remain authoritative after deletion and recreation. This prevents a retried workflow step from affecting a new instance.

An unmatched take performs no mutation and MUST NOT record a receipt. It returns the current `instanceId`, `version`, and tracked read paths so replay can re-evaluate the selector after a wake.

Calls without a step ID are not exactly-once. If their outcome is uncertain, callers must read and reconcile rather than blindly retry.

## Waiters and wake delivery

A waiter records its workflow event, physical `instanceId`, observed `sinceVersion`, and selector read paths. Registration and commits for one logical store MUST be linearizable with these outcomes:

- If registration linearizes before a later intersecting mutation, that mutation creates a wake obligation.
- If a mutation or instance replacement linearizes before registration and makes the supplied observation stale, registration creates an immediate wake obligation.

This coordination closes the lost-wakeup gap between an unmatched take and waiter registration. A connector MAY conservatively wake when it cannot prove that a stale change was unrelated. Spurious wakes are safe because workflow replay re-evaluates the selector; missed wakes are not safe.

“Linearizable” here means that each registration and commit must have an observable outcome equivalent to one single ordering of those operations. The suite exercises stale-before-register, register-before-commit, single-client races, and declared shared-client races; as with any finite conformance suite, those samples do not exhaustively prove every possible concurrent history.

For a current waiter, a commit creates a wake obligation only when the new version is greater than `sinceVersion` and a changed path intersects a read path by prefix. `CasStoreClient` is responsible for deriving changed paths for replacement updates and array mutations before it calls the connector. Connector implementations MUST persist and match the supplied paths without losing intersections. Over-reporting paths is allowed; under-reporting is not.

The wake obligation MUST be atomic with the state mutation or stale registration that creates it. After that atomic action commits, scheduler failure MUST NOT roll back or poison the store operation. A failed obligation MUST remain pending and be retried whenever the connector next drains wake delivery, including on subsequent mutating store activity and, for a durable connector, when the backend is reopened. This protocol version requires no autonomous timer or maximum retry interval when there is no further store activity. One failing delivery MUST NOT block unrelated deliveries in the same drain.

Delivery is at-least-once, not exactly-once. A process can crash after the scheduler accepts a wake and before the connector records success, so the scheduler and workflow replay path MUST tolerate duplicates. After successful delivery, the connector MUST consume the waiter observation associated with the pending obligation. Acknowledgement MUST be guarded strongly enough that a re-registration with a newer `sinceVersion` under the same waiter key remains registered; connectors MAY coalesce an equivalent re-registration with the same observed version.

A durable transactional outbox keyed by store, execution, and step is the recommended implementation, but it is not part of the protocol. Any design satisfying atomic intent, crash recovery, retry isolation, and generation-safe acknowledgement conforms.

## Failure boundaries

Once a state mutation and its wake obligations commit, wake transport errors SHOULD be handled as best-effort delivery failures rather than changing the mutation result. A rejected public promise does not prove that no commit occurred. Exactly-once recovery is available only by repeating the call with the same step ID; otherwise the caller must read and reconcile.

Validation failures and asynchronous updater or claim callbacks MUST leave state, receipts, and wake obligations unchanged.

## Running the suite

See [`@yieldstar/store-conformance`](../packages/store-conformance/README.md) for the factory API and a minimal Vitest example. The YieldStar CI runs the same artifact against the in-memory connector and the Bun and Node SQLite connectors. SQLite declares shared-client and durable-restart capabilities; the in-memory connector qualifies only for process-local use.

---
status: proposal
created_at: 2026-07-30
---

# Durable External Effect

## Abstract

A worker can crash after an external system finishes an operation but before Yieldstar saves the result. Therefore, retrying can perform the operation twice, while stopping can leave the workflow without its result.

We solve this with `step.effect`, which makes an external operation safe to retry after a crash. When the external system can look up the operation by key, Yieldstar calls it again only after that system confirms that the first call did not finish.

## Problem

An external operation can finish before `step.run` records its result, so running the workflow again cannot distinguish “finished, response lost” from “the external system was never called.” A record of unfinished operations, a lookup in the external system, and a recovery scan can resolve the ambiguity, but they spread one recovery process across workflow code, stores, and recovery jobs.

### Before

```ts
const resource = yield* step.run(`provision:${accountId}`, async () => {
  const result = await cloud.provision(`provision:${accountId}`, configuration)

  // If the worker dies here, running this step again calls provision again.
  return result
})
```

## Proposal

Add `step.effect`, a boundary around an external operation that records intent before calling the external system, checks uncertain outcomes by stable business key, and remains unfinished until that system supplies an answer:

### After

```ts
const resource = yield* step.effect(`provision:${accountId}`, {
  // Ask the external system whether an earlier call finished before calling it again.
  lookup: key => cloud.lookup(key),
  perform: key => cloud.provision(key, configuration),
})
```

The API keeps lookup separate from the call that performs the operation, so an unknown outcome cannot accidentally repeat it.

## Proposed API

```ts
type EffectLookup<T> =
  | {
      status: "settled"
      result: T
    }
  | {
      status: "not-found"
    }
  | {
      status: "unknown"
    }

interface StepRunner {
  effect<T>(
    key: string,
    operation: {
      lookup(key: string): Promise<EffectLookup<T>>
      perform(key: string): Promise<T>
    }
  ): AsyncGenerator<StepResponse, T>
}
```

`settled` means the external system can prove the operation's result. `not-found` means it can prove that no operation with that key finished, so calling it is safe. `unknown` means it cannot yet distinguish those states.

## Required Semantics

- The effect key identifies one business operation independently of workflow history.
- Yieldstar records the operation as unfinished before calling the external system.
- After an uncertain result or worker crash, Yieldstar calls `lookup` before it may call `perform` again.
- `settled` returns the recorded result, `not-found` permits `perform`, and `unknown` permits neither.
- A returned refusal is a settled result, not an exception.
- An unresolved effect remains unfinished and must be checked again; it must not become a permanently failed workflow with nobody responsible for the operation.
- A settled result must remain authoritative for as long as the same effect key can be encountered again.
- This proposal does not claim that the external call itself runs only once.

## External System Contract

The external system must:

- treat repeated calls with the same effect key as the same operation
- return the same completed result for repeated lookup
- distinguish `not-found` from `unknown`
- eventually return `settled` or `not-found` for the guarantees that depend on progress

If the external system permanently cannot determine whether an operation finished, Yieldstar cannot derive the answer. The effect remains pending rather than guessing or calling the system again after an unknown result.

## Acceptance Histories

An implementation must explain these histories:

1. The external system creates a resource and the worker crashes before recording the response. Lookup finds the resource and no duplicate is created.
2. The external system proves that the key is absent. Yieldstar calls `perform` with that key.
3. The external system returns `unknown`. Yieldstar checks again later without repeating the operation.
4. The workflow restarts or its code is redeployed while the effect is unfinished. The next attempt checks the same operation key before calling the external system.

## Not Specified

This RFC does not choose the effect-record schema, storage location, retry schedule, backoff policy, or record-retention duration.

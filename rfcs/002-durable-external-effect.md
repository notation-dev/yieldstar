---
status: proposal
---

# Durable External Effect

## Abstract

A worker can crash after an external system finishes an operation but before Yieldstar saves the result. Therefore, retrying can perform the operation twice, while stopping can leave the workflow without its result.

We solve this with `step.effect`, which will ask the service running the external effect for an idempotency key for the operation. This key can then be used in subsequent tries to check if the operation actaully ran. With this check in place external operations can be retried safely even in the case of the worker crashing.

## Problem

`step.run` records its result after its function returns:

```ts
const resource = yield* step.run(`provision:${accountId}`, async () => {
  return cloud.provision(configuration)
})

// If the resource was created but this response was lost, retrying will
// create another resource.
```

If the cloud service creates the resource but the response is lost, retrying this step calls `provision` again.

## Public API

```ts
type DurableValue =
  | null
  | boolean
  | number
  | string
  | DurableValue[]
  | { [key: string]: DurableValue }

type EffectLookup<T extends DurableValue> =
  | { status: "settled"; result: T }
  | { status: "not-found" }
  | { status: "unknown" }

type EffectDescriptor<T extends DurableValue> = {
  effectId: string
  operation: string
  input: { [key: string]: DurableValue }
  retryIn: number
  lookup(effectId: string): Promise<EffectLookup<T>>
  perform(effectId: string): Promise<T>
}

interface StepRunner {
  effect<T extends DurableValue>(
    stepKey: string,
    effect: EffectDescriptor<T>
  ): AsyncGenerator<StepResponse, T, StepResult | StepError>
}
```

For example:

```ts
const resource = yield* step.effect(`provision:${accountId}`, {
  // The step key belongs to this workflow execution. This ID belongs to the
  // external operation and must be shared by every caller of that operation.
  effectId: `account:${accountId}`,
  operation: "cloud.provision.v1",
  input: configuration,
  retryIn: 60_000,
  lookup: id => cloud.lookup(id),
  // Yieldstar will call perform again only after lookup proves that no
  // earlier call exists or can still finish.
  perform: id => cloud.provision(id, configuration),
})
```

`stepKey` will identify the step within one workflow execution. `effectId` will identify the external operation, even when several runtimes can call the same external system.

Every caller of one external operation must use the same `effectId`. No caller may use that ID for a different operation.

`operation` will name the version of the behavior defined by `input`, `lookup`, and `perform`. It will not change after the effect record is created.

Workflow code that can access an effect record will be trusted to read its result.

An application should build `effectId` from every part needed to identify one external operation. Depending on the application, those parts may include:

- the provider account;
- the tenant;
- the kind of operation; and
- the business identity.

`input`, lookup results, and performed results will accept:

- `null`;
- booleans;
- finite numbers;
- strings;
- arrays with no missing items; and
- plain objects with string keys whose values follow these same rules.

A plain object will:

- have the default or `null` prototype; and
- contain only its own enumerable data properties.

Values will reject:

- accessors;
- class instances;
- symbol or non-enumerable properties;
- missing array items;
- `undefined`; and
- reference cycles.

The canonical encoding will sort object keys and encode `-0` as `0`.

## External system contract

Every runtime that calls the external system will need to use the same `effectId` for the same operation. The external system must provide these guarantees for that identity:

1. Concurrent or repeated `perform` calls refer to one operation and return one result.
2. `not-found` proves that no accepted, running, or completed call exists and that no earlier call can later finish.
3. `settled` returns the same result as every successful `perform` call and remains stable.
4. `unknown` means neither `perform` nor absence is safe to assume. A later `lookup` may try again.

A rejected `lookup` or `perform` call will also be an unknown outcome. If the external system cannot provide these guarantees, `step.effect` will not make the operation safe.

## Runtime protocol

`step.effect` will require the delivery acknowledgement from RFC 001.

This RFC will add an `EffectClient` to `@yieldstar/core`. `WorkflowRunner` will pass it to the workflow driver through `WorkflowGeneratorParams`.

`EffectClient` will own effect records. Each record will:

- be identified by `effectId`;
- store the immutable `operation` and `input`;
- have a state of `pending` or `settled`;
- store a result when settled; and
- never be deleted or reused.

```ts
interface EffectClient {
  begin(request: {
    operation: string
    effectId: string
    input: { [key: string]: DurableValue }
    executionId: string
    stepKey: string
  }): Promise<
    | { status: "new" }
    | { status: "pending" }
    | { status: "settled"; result: DurableValue }
    | { status: "rejected"; code: "EFFECT_REQUEST_MISMATCH" }
  >

  settle(request: {
    operation: string
    effectId: string
    result: DurableValue
  }): Promise<
    | { status: "settled"; result: DurableValue }
    | {
        status: "conflict"
        result: DurableValue
        conflictingResult: DurableValue
      }
  >

  wait(request: {
    effectId: string
    event: WorkflowEvent
    stepKey: string
    wakeAt: number
  }): Promise<{ wakeAt: number }>
}

class EffectClientInvariantError extends Error {
  code: "EFFECT_RUNTIME_INVARIANT" | "EFFECT_WAITER_MISMATCH"
}

interface WorkflowEffectError extends Error {
  code: "INVALID_EFFECT_REQUEST" | "EFFECT_REQUEST_MISMATCH"
}
```

`begin` will create a `pending` record before returning `new`. If the record already exists, `begin` will return its state.

If an existing identity has a different `operation` or `input`, `begin` will return `EFFECT_REQUEST_MISMATCH`. Otherwise, it will also remove any waiter left by the same execution and step after a delivered wake. Values will be equal when their canonical encodings are equal.

`settle` will change a `pending` record to `settled` only once.

Concurrent calls with the same encoded result will return that result. If a call supplies a different result, `settle` will:

1. keep the first result;
2. store a permanent conflict report containing both values; and
3. return `conflict`.

Runtime operators will be able to inspect these reports.

`wait` will make one atomic change that:

1. stores the current workflow event in a waiter; and
2. creates a scheduled wake request.

The waiter will be identified by the effect ID, `event.executionId`, and step key. Repeating `wait` will return the first `wakeAt` without adding another waiter or wake request.

If the workflow ID, parameters, or context differ from the stored event, `wait` will throw `EFFECT_WAITER_MISMATCH`. `retryIn` must be finite and non-negative. The driver will calculate `wakeAt` before calling `wait`.

When `settle` succeeds, it will make one atomic change that:

1. creates immediate wake requests for all waiters; and
2. removes those waiters.

`EffectWakeDispatcher` will be a long-lived service in the runtime process, not in a child worker. It will own `SchedulerClient`, start with the runtime, and resume draining stored wake requests after every restart.

For a scheduled wake, the dispatcher will pass `max(0, wakeAt - Date.now())` to `SchedulerClient.requestWakeUp`. The scheduler will accept a wake by durably storing the event and resolving its promise. Only then will the dispatcher remove the request.

A lost scheduler response may create a duplicate wake. This will be safe because both deliveries will read the same effect and step records.

`DurableValueCodec` will be the only validator and canonical encoder for `DurableValue`:

- the driver will use it before `begin` and `settle`;
- `EffectClient` will use it whenever it reads or writes a value; and
- `StepResult` will use it for its result.

Error revival will apply only to `StepError`. A plain object that resembles an error will therefore remain a plain object after serialization.

## Driver protocol

This RFC will add two responses:

```ts
class StepEffect<T extends DurableValue> extends StepResponse {
  readonly type = "step-effect"
  constructor(readonly effect: EffectDescriptor<T>) {
    super()
  }
}

class StepEffectWait extends StepResponse {
  readonly type = "effect-wait"
  constructor() {
    super()
  }
}
```

`step.effect` will yield its step key and ask whether a result is already recorded. If no result exists, it will yield `StepEffect`. This response will carry the descriptor and callbacks from the public API.

The driver will handle `StepEffect` before writing a step record. For a result or final error, the driver will:

1. write `StepResult` or `StepError`; and
2. resume the paused generator with that response.

`step.effect` will return the result or throw the error. `StepEffect` will never be serialized.

Step-response deserialization will gain an `effect-wait` case for `StepEffectWait`. The workflow driver will treat this response as unfinished, like `StepStoreWait`. `WorkflowRunner` will add it to its return union and switch, then return without taking another action.

The generator will remain paused. A later delivery will ignore the unfinished record and start the effect step again. The worker will acknowledge suspension only after both `wait` and the unfinished record succeed.

The driver behavior is:

| Outcome | Behavior |
| --- | --- |
| Invalid `effectId`, `operation`, `input`, or `retryIn` | The driver will record and throw `INVALID_EFFECT_REQUEST` before `begin`. |
| `begin` returns `new` | The driver will call `perform`. |
| `begin` returns `pending` | The driver will call `lookup`. |
| `begin` returns `settled` | The driver will record and return its result without calling a callback. |
| `begin` returns `EFFECT_REQUEST_MISMATCH` | The driver will record and throw that code without calling a callback. |
| `perform` returns or `lookup` returns `settled` | The driver will validate the result, call `settle`, then record and return its result. |
| `lookup` returns `not-found` | The driver will call `perform`. |
| A callback rejects or `lookup` returns `unknown` | The driver will call `wait` and return `StepEffectWait`. |
| `settle` reports a conflict | The driver will report it and record the first result. |
| `begin`, `settle`, or `wait` throws an ordinary error | The driver will record no step and request another delivery with `EFFECT_CLIENT_UNAVAILABLE`. |
| A callback returns a malformed response or invalid value | The driver will record no step, retain `pending`, and request another delivery with `EFFECT_HANDLER_INVALID`. |
| `EffectClient` throws `EffectClientInvariantError` | The driver will record no step and request another delivery with its code. |

`INVALID_EFFECT_REQUEST` and `EFFECT_REQUEST_MISMATCH` will be recorded as `WorkflowEffectError` values. Workflow code may catch them, and their stable `code` will survive serialization.

`EFFECT_CLIENT_UNAVAILABLE` will describe an uncertain failure that may recover without intervention. The following errors will require operator repair if they persist:

- `EFFECT_HANDLER_INVALID`;
- `EFFECT_RUNTIME_INVARIANT`; and
- `EFFECT_WAITER_MISMATCH`.

All four errors that request another delivery will pass through workflow code without being caught. They will leave the delivery unacknowledged under [RFC 001](./001-durable-workflow-start.md#delivery-acknowledgement).

While an effect remains pending, the current workflow code must reach the same `effectId` and provide callbacks with the same external-system contract.

## Conformance tests

Runtime-adapter tests will inspect only effect records, waiters, and wake requests:

| Operation or race | Observable outcome |
| --- | --- |
| `begin` creates or reads a record | One record exists for the effect ID and contains immutable operation and input. |
| `begin` receives changed operation or input | It rejects without changing the record. |
| `settle` receives equal results concurrently | One settled result exists. |
| `settle` receives different results | The first result remains settled and one conflict report contains both values. |
| Failure after preparing the waiter but before commit | No waiter or wake request is visible. |
| Failure after preparing the wake request but before commit | No waiter or wake request is visible. |
| `wait` commits and its response is lost | Repeating it returns the first wake time and adds nothing. |
| Repeated `wait` carries a different event | It throws `EFFECT_WAITER_MISMATCH` and preserves the first waiter and wake request. |
| Settlement races with `wait` | No waiter exists without an immediate or scheduled wake request. |
| Dispatcher restarts | It resumes draining stored wake requests. |
| Scheduler accepts a wake but its response is lost | The request remains; resubmission may add one harmless duplicate. |
| Scheduler confirms a wake | The dispatcher removes its request. |

Workflow-driver tests will use a fake client and callbacks:

| Path or interruption | Observable outcome |
| --- | --- |
| New effect | `begin`, `perform`, and `settle` run in order. |
| Pending effect with `not-found` | `begin`, `lookup`, `perform`, and `settle` run in order. |
| Already-settled effect | No callback runs and the recorded result is returned. |
| During `perform`, after external completion, or after its response | `lookup` runs before another `perform`. |
| After `lookup` returns `not-found` | `lookup` runs again before `perform`. |
| After `lookup` returns `settled` but before `settle` | `lookup` runs again and the same result is stored. |
| After `settle` but before the step result | The effect record supplies the result without an external call. |
| After the step result but before workflow continuation | The recorded step supplies the result. |
| `lookup` returns `unknown` or a callback rejects | `wait` completes before the driver returns `StepEffectWait`. |
| Invalid request | `INVALID_EFFECT_REQUEST` is recorded and reaches workflow code without calling the client. |
| Changed operation or input | `EFFECT_REQUEST_MISMATCH` is recorded and reaches workflow code without a callback. |
| Client availability failure | No step is recorded and delivery retry carries `EFFECT_CLIENT_UNAVAILABLE`. |
| Malformed lookup or invalid callback result | No step is recorded, `pending` remains, and delivery retry carries `EFFECT_HANDLER_INVALID`. |
| Client invariant or waiter mismatch | No step is recorded and delivery retry preserves its operator-repair code. |
| Conflicting settlement | The conflict is reported and the first result is recorded and returned. |

Serialization tests will round-trip every valid durable value, including an error-shaped object, without changing its type or value. They will reject every invalid value.

The tests will also prove that:

- `StepEffect` is never stored;
- `StepEffectWait` deserializes as that class; and
- its step record remains unfinished.

Integration tests will cover `EffectClient` through queue acknowledgement:

| Interruption | Observable outcome |
| --- | --- |
| `wait` commits, then the worker fails before the unfinished step record | The queue retains the delivery; replay reuses one waiter and wake request. |
| The unfinished step record commits, then the worker fails before replying | The queue retains the delivery; replay remains safe. |
| A scheduled wake request commits | The dispatcher delivers it, removes it after scheduler acceptance, and the execution runs again. |
| `settle` commits with waiters | Immediate wake requests are delivered and removed; each execution reads the settled result. |
| `EffectClient` fails inside the worker | The worker replies `retry`, the invoker rejects, the queue retains the delivery, and no step result exists. |

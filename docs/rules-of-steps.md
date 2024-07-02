# Rules of Steps

Workflow generators may be re-invoked, for example, after pausing for a delay. When a workflow is re-invoked it starts from the top, but only runs steps that have not already been run. Steps that have already been run, yield a cached value instead. This approach necessitates adherence to some rules.

Steps must be:

1. **Ordered consistently**. Ensure steps are invoked in the same order on every workflow re-invocation as step results are cached based on an order key. If the order of steps is intentionally volatile, use static cache keys instead.

```ts
// ⛔ Bad – causes step order to change between workflow executions
if (Math.random() < 0.5) {
  yield* step.run(() => { ... }
}

// ⚠️ Unidiomatic – but, if inconsistent ordering is actually desired, a static cache key ensures the cached result is independent of execution order
if (Math.random() < 0.5) {
  yield* step.run("maybe-step", () => { ... }
}

// ✅ Good – random value is consistent between workflow traversals
const randomValue = yield* step.run(() => Math.random())
if (randomValue) {
  yield* step.run(() => { ... }
}
```

2. **Stateless**. Ensure steps are stateless with respect to the outer workflow scope. Steps are only run once per workflow, even though the workflow may be invoked multiple times. If a step's output intentionally changes based on state in the workflow scope, assign it a dynamic cache key.

```ts
// ⚠️ Unidiomatic – randomValue changes only in the workflow scope, not in the step scope
const randomValue = Math.random();
const doubleRandom = yield* step.run(() => randomValue * 2);

// ⚠️ Unidiomatic – but, if a volatile step is actually desired, it can be made explicit with a dynamic cache key
let randomValue = Math.random();
let doubleRandom =
  yield* step.run(`step-${randomValue}`, () => randomValue * 2);

// ✅ Good – steps can have side effects, just understand that they will be cached
let randomValue = yield* step.run(() => Math.random());
let doubleRandom = yield* step.run(() => randomValue * 2);
```

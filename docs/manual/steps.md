# Steps

Each step wraps a discrete unit of work. 

When a step is yielded, the runtime persists the result, schedules any retries, or yields control back to the workflow to continue execution. 

On subsequent workflow executions, the runtime replays the previously cached value so the step function does not re-execute. 

Note: Steps must be yielded with `yield*`; plain `yield` produces a runtime error.

## `step.run`

`step.run` executes a function, caches its return value, and replays that cached result on subsequent workflow invocation without re-executing the function.

```ts
const result =
  yield *
  step.run(() => {
    return fetchUser(userId);
  });
```

`step.run` accepts sync or async functions:

```ts
const data =
  yield *
  step.run(async () => {
    const res = await fetch("https://api.example.com/data");
    return res.json();
  });
```

## `step.delay`

`step.delay` pauses the workflow for a given number of milliseconds. When a workflow reaches a delay, the runtime persists the resume timestamp, terminates the current execution, and schedules a wake-up. 

Once the timer fires, the runtime re-invokes the workflow. All steps before the delay replay from cache, and execution continues from the next step.

```ts
yield * step.delay(30_000); // pause for 30 seconds
```

This makes long pauses (waiting for a cooling-off period, spacing out API calls, scheduling future work) durable across process restarts without blocking a thread.

## `step.poll`

`step.poll` repeatedly evaluates a predicate at a fixed interval until it returns `true` or exhausts its retry budget. It composes `step.run` with `RetryableError` internally, so each attempt is cached and retried on the same schedule as any other step.

```ts
yield *
  step.poll({ retryInterval: 1000, maxAttempts: 10 }, async () => {
    const status = await checkDeployment(deployId);
    return status === "ready";
  });
```

If the predicate returns `false` on every attempt, the step throws after `maxAttempts`. If the predicate throws a non-retryable error, execution stops immediately.

## Cache keys

Yieldstar derives a cache key for each step automatically from the call site. This works for straight-line workflows, but breaks inside loops because every iteration shares the same call site and collides.

To disambiguate, pass an explicit cache key as the first argument:

```ts
for (let i = 0; i < items.length; i++) {
  yield * step.run(`process-item:${i}`, () => processItem(items[i]));
}
```

All three step primitives accept an optional key:

```ts
yield * step.run("key", fn);
yield * step.delay("key", ms);
yield * step.poll("key", opts, predicate);
```

If two steps in the same execution resolve to the same cache key, the runtime throws: `"Each step in a loop must have a unique cache key."`

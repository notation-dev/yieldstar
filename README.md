# yieldstar 🤘

JavaScript-native distributed workflows that can be orchestrated by any backend.

```ts
import { createWorkflow, RetryableError } from "yieldstar";

const workflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    return fetch("https://randomnumber.com")
      .then((res) => res.json())
      .catch((err) => {
        throw new RetryableError(err, { maxAttempts: 5, retryInterval: 1000 });
      });
  });

  yield* step.delay(5000);

  num = yield* step.run(async () => {
    num * (await fetch("https://randomnumber.com").then((res) => res.json()));
  });

  return num;
});
```

## Examples

To install dependencies:

```bash
bun install
```

To run an example:

```bash
bun start
```

### Call-site caching

When a step is invoked without providing a cache key, Yieldstar hashes the call
site of that invocation and uses the hash as the step key. On subsequent
executions the stored hash is compared with the new call site so cached values
are ignored if a step has moved, preventing accidental reuse when steps are
re-ordered.

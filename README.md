# yieldstar 🤘

JavaScript-native distributed workflows that can be orchestrated by any backend.

```ts
import { workflow, RetryableError } from "yieldstar";

const myWorkflow = workflow(async function* (step, event, logger) {
  const { params } = event; // Access workflow parameters

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

## Passing Parameters to Workflows

You can pass parameters to workflows when triggering them:

```ts
// Trigger a workflow with parameters
const result = await sdk.triggerAndWait("myWorkflow", {
  params: {
    userId: "123",
    action: "create",
  },
});
```

Inside the workflow, you can access the parameters through the `event` object:

```ts
const myWorkflow = workflow(async function* (step, event, logger) {
  const { params } = event;

  logger.info(`Processing action ${params.action} for user ${params.userId}`);

  // Use the parameters in your workflow logic
  // ...
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

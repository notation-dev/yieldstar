::code-group

```ts [src/workflow.ts]
import { workflow } from "yieldstar"
import { $ } from "bun"

export const summarise = workflow(async function* (step) {
  let draft = yield* step.run(() => llm(`Write a blog post about ${step.params.topic}`);

  while (true) {
    const feedback = yield* step.run(() => getUserFeedback({ draft }));
    if (!feedback) break;
    draft = yield* step.run(() => llm(`Improve:\n${draft}\nFeedback:${feedback}`));
  }

  return yield* step.run(() => publish(draft));
})
```

```ts [src/trigger.ts]
import { createLocalSdk } from "yieldstar";
import { createWorkflowInvoker } from "yieldstar/bun-worker-invoker";
import { invoker } from "./shared";
import type { Router } from "./router";

const sdk = createLocalSdk<Router>(invoker);

const result = await sdk.triggerAndWait({
  workflowId: "summarise",
  params: { topic: "quantum computing", maxWords: 40 },
});

console.log(`Published to ${result.url}`);
```

::

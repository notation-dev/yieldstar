# Local SDK

`createLocalSdk` builds a typed client that triggers workflows through a `WorkflowInvoker` running in the same process. It takes your `Router` type as a generic parameter, so TypeScript checks every `workflowId` and its corresponding `params` at compile time.

## Setup

```ts
import { createLocalSdk } from "yieldstar";
import type { Router } from "./shared";

const sdk = createLocalSdk<Router>(invoker);
```

## `sdk.trigger`

Starts a workflow and returns `{ executionId }` immediately while the workflow continues running in the background.

```ts
const { executionId } = await sdk.trigger({
  workflowId: "process-order",
  params: { orderId: "abc123" },
});
```

## `sdk.triggerAndWait`

Starts a workflow and blocks until it completes, then returns the workflow's return value.

```ts
const result = await sdk.triggerAndWait({
  workflowId: "process-order",
  params: { orderId: "abc123" },
});
```

The returned promise resolves when the `WorkflowInvoker` emits the matching `executionId` on its `workflowEndEmitter`. If the workflow throws, the error propagates to the caller.

## Trigger event shape

| Field         | Type                  | Required                 | Description                                                  |
| ------------- | --------------------- | ------------------------ | ------------------------------------------------------------ |
| `workflowId`  | `string`              | Yes                      | ID matching a key in the router                              |
| `params`      | `Record<string, any>` | Depends on workflow type | Input data accessible via `event.params` inside the workflow |
| `executionId` | `string`              | No                       | Custom execution ID. Auto-generated via `nanoid` if omitted  |

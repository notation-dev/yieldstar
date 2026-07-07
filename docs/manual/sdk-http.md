# HTTP SDK

`createHttpSdkFactory` produces a factory function that creates typed SDK clients bound to a remote server's base URL. Like the local SDK, it takes your `Router` type as a generic parameter so TypeScript validates every `workflowId` and its corresponding `params` at compile time.

## Setup

```ts
import { createHttpSdkFactory } from "yieldstar";
import type { Router } from "./shared";

const createSdk = createHttpSdkFactory<Router>();
const sdk = createSdk({ url: "http://localhost:8080" });
```

Pass `fetchOptions` to attach custom headers or other `RequestInit` properties to every outgoing request:

```ts
const sdk = createSdk({
  url: "http://localhost:8080",
  fetchOptions: {
    headers: { Authorization: "Bearer token" },
  },
});
```

## `sdk.trigger`

Posts to `/trigger` and returns a handle containing `executionId`, `ack()`, and `waitForResult()`.

```ts
const exec = await sdk.trigger({
  workflowId: "process-order",
  params: { orderId: "abc123" },
});
```

## `exec.ack()`

Reads and parses the trigger response body, returning `{ executionId }`. Call this when you need the ID but don't need to wait for the workflow to finish.

```ts
const { executionId } = await exec.ack();
```

## `exec.waitForResult()`

Posts to `/events` with the `executionId` and blocks until the workflow completes, then returns the result.

```ts
const result = await exec.waitForResult();
```

If the workflow threw an error, `waitForResult` deserializes the error and re-throws it with the original stack trace preserved.

## Trigger event shape

| Field         | Type                  | Required                 | Description                                                  |
| ------------- | --------------------- | ------------------------ | ------------------------------------------------------------ |
| `workflowId`  | `string`              | Yes                      | ID matching a key in the router                              |
| `params`      | `Record<string, any>` | Depends on workflow type | Input data accessible via `event.params` inside the workflow |
| `executionId` | `string`              | No                       | Custom execution ID. Auto-generated via `nanoid` if omitted  |
| `context`     | `Record<string, any>` | No                       | Additional context passed through middleware                 |

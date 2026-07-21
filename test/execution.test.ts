import { expect, test } from "vitest";
import { setTimeout } from "node:timers/promises";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("data flow between steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return num * 2;
    });

    return num;
  });

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(result).toBe(2);
});

test("handling async steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(async () => {
      await setTimeout(10);
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const sdk = createSdk({ workflow });

  const result = await sdk.triggerAndWait({ workflowId: "workflow" });
  expect(result).toBe(2);
});

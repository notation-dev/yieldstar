import { expect, test } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("failing steps can be caught", async () => {
  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        throw new Error("Step error");
      });
    } catch {
      return true;
    }
  });

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(result).toBe(true);
});

test.skip("errors should be thrown by trigger", async () => {
  const workflow = createWorkflow(async function* (step) {
    throw new Error("Step error");
  });
  const sdk = createSdk({ workflow });
  expect(() => sdk({ workflowId: "workflow" })).toThrow();
});

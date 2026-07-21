import { expect, test, vi } from "vitest";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("loop detection with implicit keys", async () => {
  const runSpy = vi.fn(() => 1);

  const workflow = createWorkflow(async function* (step) {
    for (let i = 0; i < 2; i++) {
      yield* step.run(runSpy);
    }
  });

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  // The loop should be detected on the second attempt, so the function
  // backing step.run should only be executed once
  expect(runSpy).toBeCalledTimes(1);

  expect(result).toBeInstanceOf(Error);
  expect((result as unknown as Error).message).toContain(
    "Each step in a loop must have a unique cache key.",
  );
});

test("no loop detection with explicit keys", async () => {
  const runSpy = vi.fn(() => 1);

  const workflow = createWorkflow(async function* (step) {
    for (let i = 0; i < 2; i++) {
      yield* step.run(`cache-key-${i}`, runSpy);
    }
  });

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(runSpy).toBeCalledTimes(2);
  expect(result).toBe(undefined);
});

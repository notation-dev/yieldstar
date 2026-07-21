import { expect, test, vi } from "vitest";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("step.run without cache keys", async () => {
  const mock1 = vi.fn(() => 1);
  const mock2 = vi.fn(() => 2);

  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run(mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run(mock2);
    }
  });

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).toBeCalledTimes(1);
});

test("step.run with cache keys", async () => {
  const mock1 = vi.fn(() => 1);
  const mock2 = vi.fn(() => 2);

  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run("step 1", mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run("step 2", mock2);
    }
  });

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).toBeCalledTimes(1);
});

test("step.delay without cache keys", async () => {
  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay(10);
    } else {
      yield* step.delay(10);
    }
  });

  let startTime = Date.now();

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  let duration = Date.now() - startTime;

  // expect both delays to be invoked
  expect(duration).toBeGreaterThanOrEqual(20);
  expect(duration).toBeLessThan(50);
});

test("step.delay with cache keys", async () => {
  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay("step 1", 10);
    } else {
      yield* step.delay("step 2", 10);
    }
  });

  let startTime = Date.now();

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  let duration = Date.now() - startTime;

  // expect second delay to trigger a new timer
  expect(duration).toBeGreaterThanOrEqual(20);
  expect(duration).toBeLessThan(50);
});

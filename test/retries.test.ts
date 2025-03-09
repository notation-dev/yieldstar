import { expect, test } from "bun:test";
import { createWorkflow, RetryableError } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";
import { pino } from "pino";

const logger = pino({ level: "fatal" });
const createSdk = createTestSdkFactory({ logger });

test("retrying an error for maxAttempts", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      throw new RetryableError("Step error", {
        maxAttempts: 10,
        retryInterval: 1,
      });
    });
  });

  try {
    const sdk = createSdk({ workflow });
    await sdk.triggerAndWait({ workflowId: "workflow" });
  } catch {
    expect(runs).toEqual(10);
  }
});

test("retrying an for maxAttempts (irrespective of number of times error is thrown)", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      if (runs === 5) {
        throw new RetryableError("Step error", {
          maxAttempts: 4,
          retryInterval: 1,
        });
      }
      throw new RetryableError("Step error", {
        maxAttempts: 10,
        retryInterval: 1,
      });
    });
  });

  try {
    const sdk = createSdk({ workflow });
    await sdk.triggerAndWait({ workflowId: "workflow" });
  } catch {
    expect(runs).toEqual(5);
  }
});

test("retrying an for maxAttempts (irrespective of number of number of workflow executions)", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        runs++;
        throw new RetryableError("Step error", {
          maxAttempts: 3,
          retryInterval: 1,
        });
      });
    } catch {}
    try {
      yield* step.run(async () => {
        runs++;
        throw new RetryableError("Step error", {
          maxAttempts: 3,
          retryInterval: 1,
        });
      });
    } catch {}
  });

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(runs).toEqual(6);
});

test("retrying an error after retry interval", async () => {
  const executions: number[] = [];
  let start = Date.now();

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      executions.push((Date.now() - start) / 100);
      if (executions.length > 3) return;
      throw new RetryableError("Step error", {
        maxAttempts: 4,
        retryInterval: 100,
      });
    });
  });

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(executions[0]).toBeCloseTo(0, 0);
  expect(executions[1]).toBeCloseTo(1, 0);
  expect(executions[2]).toBeCloseTo(2, 0);
  expect(executions[3]).toBeCloseTo(3, 0);
});

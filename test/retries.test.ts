import { expect, test } from "bun:test";
import { createWorkflow, RetryableError } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";
import { pino } from "pino";

const logger = pino({ level: "fatal" });
const runner = createWorkflowTestRunner({ logger });

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
    await runner.triggerAndWait(workflow);
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
    await runner.triggerAndWait(workflow);
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

  await runner.triggerAndWait(workflow);

  expect(runs).toEqual(6);
});

test("retrying an error after retry interval", async () => {
  const executions: number[] = [];

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      executions.push(Date.now());
      if (executions.length > 3) return;
      throw new RetryableError("Step error", {
        maxAttempts: 4,
        retryInterval: 100,
      });
    });
  });

  await runner.triggerAndWait(workflow);
});

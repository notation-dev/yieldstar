import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, Executor, RetryableError } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-retries.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

beforeEach(() => {
  sqlitePersister.deleteAll();
});

test("retrying an error for maxAttempts", async () => {
  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      throw new RetryableError("Step error", {
        maxAttempts: 10,
        retryInterval: 1,
      });
    });
  });

  try {
    await executor.runAndAwaitResult({
      workflow: myWorkflow,
      executionId: "abc:123",
    });
  } catch {
    expect(runs).toEqual(10);
  }
});

test("retrying an for maxAttempts (irrespective of number of times error is thrown)", async () => {
  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
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
    await executor.runAndAwaitResult({
      workflow: myWorkflow,
      executionId: "abc:123",
    });
  } catch {
    expect(runs).toEqual(5);
  }
});

test("retrying an for maxAttempts (irrespective of number of number of workflow executions)", async () => {
  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
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

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(runs).toEqual(6);
});

test("retrying an error after retry interval", async () => {
  const executions: number[] = [];

  const myWorkflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      executions.push(Date.now());
      if (executions.length > 3) return;
      throw new RetryableError("Step error", {
        maxAttempts: 4,
        retryInterval: 100,
      });
    });
  });

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });
});

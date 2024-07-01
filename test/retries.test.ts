import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion, RetryableError } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-retries.sqlite");
const sqlitePersister = new SqlitePersister({ db });

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
    await runToCompletion({
      workflow: myWorkflow,
      persister: sqlitePersister,
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
    await runToCompletion({
      workflow: myWorkflow,
      persister: sqlitePersister,
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

  await runToCompletion({
    workflow: myWorkflow,
    persister: sqlitePersister,
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

  await runToCompletion({
    workflow: myWorkflow,
    persister: sqlitePersister,
    executionId: "abc:123",
  });

  const intervals = [
    executions[3] - executions[2],
    executions[2] - executions[1],
    executions[1] - executions[0],
  ];

  for (const interval of intervals) {
    expect(interval).toBeGreaterThan(100);
    expect(interval).toBeLessThan(105);
  }
});

import { beforeEach, expect, test, mock } from "bun:test";
import { createWorkflow, runToCompletion, RetryableError } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-retries.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
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
      connector: sqliteConnector,
      executionId: "abc:123",
    });
  } catch {
    expect(runs).toEqual(10);
  }
});

test("maxAttempts refers to number of step attempts, not number of times error is thrown", async () => {
  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      if (runs === 5) {
        throw new RetryableError("Step error", {
          maxAttempts: 5,
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
      connector: sqliteConnector,
      executionId: "abc:123",
    });
  } catch {
    expect(runs).toEqual(5);
  }
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
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  const intervals = [
    executions[3] - executions[2],
    executions[2] - executions[1],
    executions[1] - executions[0],
  ];

  for (const interval of intervals) {
    expect(interval).toBeGreaterThan(100);
  }
});

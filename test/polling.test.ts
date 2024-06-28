import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-retries.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
});

test("poll retries when predicate fails", async () => {
  let runs: number = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        return false;
      });
    } catch {}
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(runs).toBe(10);
});

test("poll resolves when predicate passes", async () => {
  let runs: number = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
      runs++;
      return true;
    });
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(runs).toBe(1);
});

test("poll fails if a regular error is thrown", async () => {
  let runs: number = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        throw new Error("Step error");
      });
    } catch {}
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(runs).toBe(1);
});

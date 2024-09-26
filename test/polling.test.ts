import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-polling.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

beforeEach(() => {
  sqlitePersister.deleteAll();
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

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
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

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
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

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(runs).toBe(1);
});

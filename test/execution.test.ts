import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-execution.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

beforeEach(() => {
  sqlitePersister.deleteAll();
});

test("data flow between steps", async () => {
  const myWorkflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return num * 2;
    });

    return num;
  });

  const result = await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(result).toBe(2);
});

test("handling async steps", async () => {
  const myWorkflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(async () => {
      await Bun.sleep(10);
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const result = await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(result).toBe(2);
});

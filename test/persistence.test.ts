import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-persistence.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

beforeEach(() => {
  sqlitePersister.deleteAll();
});

test("retrieving previous steps from cache", async () => {
  const returnedValues: number[] = [];
  const yieldedValues: number[] = [];

  const myWorkflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      returnedValues.push(1);
      return 1;
    });

    yieldedValues.push(num);

    // Force generator to restart
    yield* step.delay(10);

    num = yield* step.run(async () => {
      const val = await Promise.resolve(num * 2);
      returnedValues.push(val);
      return val;
    });

    yieldedValues.push(num);

    // Force generator to restart
    yield* step.delay(10);

    return num;
  });

  await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(returnedValues).toEqual([1, 2]);
  expect(yieldedValues).toEqual([1, 1, 2, 1, 2]);
});

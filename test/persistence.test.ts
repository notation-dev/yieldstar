import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-persistence.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
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

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(returnedValues).toEqual([1, 2]);
  expect(yieldedValues).toEqual([1, 1, 2, 1, 2]);
});

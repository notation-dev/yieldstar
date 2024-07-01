import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-execution.sqlite");
const sqlitePersister = new SqlitePersister({ db });

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

  const result = await runToCompletion({
    workflow: myWorkflow,
    persister: sqlitePersister,
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

  const result = await runToCompletion({
    workflow: myWorkflow,
    persister: sqlitePersister,
    executionId: "abc:123",
  });

  expect(result).toBe(2);
});

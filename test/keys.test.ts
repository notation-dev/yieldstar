import { beforeEach, expect, test, mock } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-persistence.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
});

test.skip("non-deterministic workflows", async () => {
  const mock1 = mock(() => 1);
  const mock2 = mock(() => 2);

  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    if (runs++) {
      yield* step.run(mock1);
    } else {
      yield* step.run(mock2);
    }

    yield* step.delay(1);
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).toBeCalledTimes(1);
});

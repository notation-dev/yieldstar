import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-retries.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
});

test("failing steps can be caught", async () => {
  let runs = 0;

  const myWorkflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        runs++;
        throw new Error("Step error");
      });
    } catch {
      return true;
    }
  });

  const result = await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(result).toBe(true);
});

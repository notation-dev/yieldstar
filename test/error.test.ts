import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-error.sqlite");
const sqlitePersister = new SqlitePersister({ db });

beforeEach(() => {
  sqlitePersister.deleteAll();
});

test("failing steps can be caught", async () => {
  const myWorkflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        throw new Error("Step error");
      });
    } catch {
      return true;
    }
  });

  const result = await runToCompletion({
    workflow: myWorkflow,
    persister: sqlitePersister,
    executionId: "abc:123",
  });

  expect(result).toBe(true);
});

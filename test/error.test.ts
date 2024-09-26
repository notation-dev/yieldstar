import { beforeEach, expect, test } from "bun:test";
import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/test-error.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

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

  const result = await executor.runAndAwaitResult({
    workflow: myWorkflow,
    executionId: "abc:123",
  });

  expect(result).toBe(true);
});

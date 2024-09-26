import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

sqlitePersister.deleteAll();

const myWorkflow = createWorkflow(async function* (step) {
  let num: number;

  yield* step.poll({ retryInterval: 1000, maxAttempts: 10 }, () => {
    console.log("Polling");
    num = Math.random();
    return num > 0.75;
  });

  yield* step.run(() => {
    console.log("Poll finished. Final result:", num);
  });
});

await executor.runAndAwaitResult({
  workflow: myWorkflow,
  executionId: "abc:123",
});

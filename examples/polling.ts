import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

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

await runToCompletion({
  workflow: myWorkflow,
  persister: sqlitePersister,
  executionId: "abc:123",
});

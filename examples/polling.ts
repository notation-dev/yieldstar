import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/workflows.sqlite");
const sqliteConnector = new SqliteConnector({ db });

sqliteConnector.deleteAll();

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
  connector: sqliteConnector,
  executionId: "abc:123",
});

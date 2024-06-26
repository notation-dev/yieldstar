import { createWorkflow, runToCompletion, RetryableError } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/workflows.sqlite");
const sqliteConnector = new SqliteConnector({ db });

sqliteConnector.deleteAll();

const myWorkflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2. Rolling dice...");

    if (Math.random() > 0.5) {
      console.log("Unlucky! Throwing error");
      throw new RetryableError("Unlucky", {
        maxAttempts: 10,
        retryInterval: 1000,
      });
    }

    console.log("Lucky! Resolving step");
    return Promise.resolve(num * 2);
  });

  return num;
});

const result = await runToCompletion({
  workflow: myWorkflow,
  connector: sqliteConnector,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${result}\n`);

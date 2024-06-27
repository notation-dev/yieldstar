import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/workflows.sqlite");
const sqliteConnector = new SqliteConnector({ db });

sqliteConnector.deleteAll();

let executionIdx = -1;

const myWorkflow = createWorkflow(async function* (step) {
  executionIdx++;
  let volatileNum = 0;
  let stableNum = 0;

  // a different step will run on re-invocation of the workflow
  // therefore the steps need cache keys
  if (executionIdx === 0) {
    stableNum = yield* step.run("step-1", () => 1);
    volatileNum = yield* step.run(() => 1);
  } else {
    volatileNum = yield* step.run(() => 2);
    stableNum = yield* step.run("step-2", () => 2);
  }

  // trigger a second invocation of the workflow
  yield* step.delay(100);

  return { stableNum, volatileNum };
});

const result = await runToCompletion({
  workflow: myWorkflow,
  connector: sqliteConnector,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${JSON.stringify(result)}\n`);

import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

sqlitePersister.deleteAll();

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
  persister: sqlitePersister,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${JSON.stringify(result)}\n`);

import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/workflows.sqlite");
const sqliteConnector = new SqliteConnector({ db });

sqliteConnector.deleteAll();

const myWorkflow = createWorkflow(async function* (step) {
  let numbers: number[] = [];

  let i = 0;
  while (i < 10) {
    const num = yield* step.run(async () => {
      return i * 2;
    });
    yield* step.delay(10);
    numbers.push(num);
    i++;
  }

  return numbers;
});

const result = await runToCompletion({
  workflow: myWorkflow,
  connector: sqliteConnector,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${result}\n`);

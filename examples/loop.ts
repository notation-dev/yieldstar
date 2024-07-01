import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

sqlitePersister.deleteAll();

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
  persister: sqlitePersister,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${result}\n`);

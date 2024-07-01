import { createWorkflow, runToCompletion } from "yieldstar";
import { MemoryPersister } from "yieldstar-persister-memory";

const memoryPersister = new MemoryPersister();

const myWorkflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2");
    return Promise.resolve(num * 2);
  });

  return num;
});

const result = await runToCompletion({
  workflow: myWorkflow,
  persister: memoryPersister,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${result}\n`);

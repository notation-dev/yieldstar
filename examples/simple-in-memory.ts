import {
  createWorkflow,
  runToCompletion,
  MemoryConnector,
} from "yield-star-workflows";

const memoryConnector = new MemoryConnector();

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
  connector: memoryConnector,
  executionId: "abc:123",
});

console.log(`\nWorkflow Result: ${result}\n`);

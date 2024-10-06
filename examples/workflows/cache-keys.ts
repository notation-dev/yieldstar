import { createWorkflow } from "yieldstar";

let executionIdx = -1;

export const cacheKeysWorkflow = createWorkflow(async function* (step) {
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

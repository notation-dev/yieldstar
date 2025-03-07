import { workflow } from "yieldstar";

export const simpleWorkflow = workflow(async function* (step, event, logger) {
  let num = yield* step.run(() => {
    logger.info("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    logger.info("In step 2");
    return Promise.resolve(num * 2);
  });

  return num;
});

import { createWorkflow, RetryableError } from "yieldstar";

export const errorsWorkflow = createWorkflow(async function* (step, logger) {
  let num = yield* step.run(() => {
    logger.info("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    logger.info("In step 2. Rolling dice...");

    if (Math.random() > 0.25) {
      logger.info("Unlucky! Throwing error");
      throw new RetryableError("Unlucky", {
        maxAttempts: 2,
        retryInterval: 5000,
      });
    }

    logger.info("Lucky! Resolving step");
    return Promise.resolve(num * 2);
  });

  return num;
});

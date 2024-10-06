import { createWorkflow, RetryableError } from "yieldstar";

export const errorsWorkflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2. Rolling dice...");

    if (Math.random() > 0.25) {
      console.log("Unlucky! Throwing error");
      throw new RetryableError("Unlucky", {
        maxAttempts: 2,
        retryInterval: 5000,
      });
    }

    console.log("Lucky! Resolving step");
    return Promise.resolve(num * 2);
  });

  return num;
});

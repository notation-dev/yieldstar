import { createWorkflow, Executor } from "yieldstar";
import {
  LocalScheduler,
  LocalEventLoop,
  LocalPersister,
} from "yieldstar-local";
import { RetryableError } from "yieldstar/dist";

const localEventLoop = new LocalEventLoop();
const localPersister = new LocalPersister();

const localScheduler = new LocalScheduler({
  taskQueue: localEventLoop.taskQueue,
  timers: localEventLoop.timers,
});

const executor = new Executor({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localEventLoop.waker,
});
const workflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2. Rolling dice...");

    if (Math.random() > 0.5) {
      console.log("Unlucky! Throwing error");
      throw new RetryableError("Unlucky", {
        maxAttempts: 10,
        retryInterval: 1000,
      });
    }

    console.log("Lucky! Resolving step");
    return Promise.resolve(num * 2);
  });

  return num;
});

localEventLoop.start();

const result = await executor.runAndAwaitResult(workflow);
console.log(`\nWorkflow Result: ${result}\n`);

localEventLoop.stop();

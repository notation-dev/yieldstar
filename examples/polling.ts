import { createWorkflow, Executor } from "yieldstar";
import {
  LocalScheduler,
  LocalEventLoop,
  LocalPersister,
} from "yieldstar-local";

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
  let num: number;

  yield* step.poll({ retryInterval: 1000, maxAttempts: 10 }, () => {
    console.log("Polling");
    num = Math.random();
    return num > 0.75;
  });

  yield* step.run(() => {
    console.log("Poll finished. Final result:", num);
  });
});

localEventLoop.start();

await executor.runAndAwaitResult(workflow);

localEventLoop.stop();

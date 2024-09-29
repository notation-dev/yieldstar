import { createWorkflow, Executor } from "yieldstar";
import { LocalScheduler, LocalRuntime, LocalPersister } from "yieldstar-local";

const localRuntime = new LocalRuntime();
const localPersister = new LocalPersister();

const localScheduler = new LocalScheduler({
  taskQueue: localRuntime.taskQueue,
  timers: localRuntime.timers,
});

const executor = new Executor({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localRuntime.waker,
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

localRuntime.start();

await executor.runAndAwaitResult(workflow);

localRuntime.stop();

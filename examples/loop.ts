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

localRuntime.start();

const result = await executor.runAndAwaitResult(workflow);
console.log(`\nWorkflow Result: ${result}\n`);

localRuntime.stop();

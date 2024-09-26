import { createWorkflow, Executor } from "yieldstar";
import {
  LocalScheduler,
  LocalWaker,
  LocalRuntime,
  LocalPersister,
} from "yieldstar-local";

const localWaker = new LocalWaker();
const localRuntime = new LocalRuntime(localWaker);
const localPersister = new LocalPersister();

const localScheduler = new LocalScheduler({
  taskQueue: localRuntime.taskQueue,
  timers: localRuntime.timers,
});

const executor = new Executor({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localWaker,
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

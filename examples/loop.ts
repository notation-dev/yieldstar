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

localEventLoop.start();

const result = await executor.runAndAwaitResult(workflow);
console.log(`\nWorkflow Result: ${result}\n`);

localEventLoop.stop();

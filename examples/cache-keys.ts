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

let executionIdx = -1;

const workflow = createWorkflow(async function* (step) {
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

localRuntime.start();

const result = await executor.runAndAwaitResult(workflow);

console.log(`\nWorkflow Result: ${JSON.stringify(result)}\n`);

localRuntime.stop();

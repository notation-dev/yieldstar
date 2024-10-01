import { createWorkflow, WorkflowEngine } from "yieldstar";
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

const workflow = createWorkflow(async function* (step) {
  let numbers: number[] = [];

  let i = 0;
  while (i < 10) {
    const num = yield* step.run(`step:${i}`, async () => {
      console.log(`In step iteration ${i}`);
      return i * 2;
    });
    yield* step.delay(10);
    numbers.push(num);
    i++;
  }

  return numbers;
});

const engine = new WorkflowEngine({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localEventLoop.waker,
  router: { "workflow-1": workflow },
});

localEventLoop.start();

const result = await engine.triggerAndWait("workflow-1");
console.log(`\nWorkflow Result: ${result}\n`);

localEventLoop.stop();

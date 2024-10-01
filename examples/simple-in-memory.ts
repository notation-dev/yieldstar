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
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2");
    return Promise.resolve(num * 2);
  });

  return num;
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

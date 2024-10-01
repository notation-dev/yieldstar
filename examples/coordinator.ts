import type { StepRunner } from "yieldstar";
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

type WorkflowFn<T> = (
  step: StepRunner,
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

// essentially a custom step
const waitForStateFactory = (step: any) =>
  async function* (state: string) {
    yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => {
      console.log("Polling...");
      // check state matches
      return true;
    });
  };

const workflowFactory = (workflowFn: WorkflowFn<any>) => {
  return createWorkflow(async function* (step) {
    const waitForState = waitForStateFactory(step);
    return yield* workflowFn(step, waitForState);
  });
};

const workflow = workflowFactory(async function* (step, waitForState) {
  const a = yield* step.run(() => 2);
  yield* waitForState("enabled");
  return yield* step.run(() => a * 3);
});

const engine = new WorkflowEngine({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localEventLoop.waker,
  router: { "workflow-1": workflow },
});

localEventLoop.start();

const result = await engine.triggerAndWait("workflow-1");
console.log(result);

localEventLoop.stop();

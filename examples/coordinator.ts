import type { StepRunner } from "yieldstar";
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

type WorkflowFn<T> = (
  step: StepRunner,
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

const coordinator = async <T>(workflowFn: WorkflowFn<T>) => {
  const workflow = createWorkflow(async function* (step) {
    const waitForState = async function* (expectedState: string) {
      yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => {
        console.log("Polling...");
        return true;
      });
    };
    return yield* workflowFn(step, waitForState);
  });

  const result = await executor.runAndAwaitResult(workflow);

  console.log(`\nWorkflow Result: ${result}\n`);
};

localEventLoop.start();

await coordinator(async function* (step, waitForState) {
  const a = yield* step.run(() => 2);
  yield* step.delay(1000);
  yield* waitForState("enabled");
  const b = yield* step.run(() => a * 3);
  return b;
});

localEventLoop.stop();

import { beforeAll, afterAll, expect, test } from "bun:test";
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

beforeAll(() => {
  localEventLoop.start();
});

afterAll(() => {
  localEventLoop.stop();
});

test("failing steps can be caught", async () => {
  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        throw new Error("Step error");
      });
    } catch {
      return true;
    }
  });

  const result = await executor.runAndAwaitResult(workflow);

  expect(result).toBe(true);
});

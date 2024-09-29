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
test("data flow between steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return num * 2;
    });

    return num;
  });

  const result = await executor.runAndAwaitResult(workflow);

  expect(result).toBe(2);
});

test("handling async steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(async () => {
      await Bun.sleep(10);
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const result = await executor.runAndAwaitResult(workflow);

  expect(result).toBe(2);
});

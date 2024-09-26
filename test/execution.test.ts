import { beforeAll, afterAll, expect, test } from "bun:test";
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

beforeAll(() => {
  localRuntime.start();
});

afterAll(() => {
  localRuntime.stop();
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

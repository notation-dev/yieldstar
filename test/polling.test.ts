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

test("poll retries when predicate fails", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        return false;
      });
    } catch {}
  });

  await executor.runAndAwaitResult(workflow);

  expect(runs).toBe(10);
});

test("poll resolves when predicate passes", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
      runs++;
      return true;
    });
  });

  await executor.runAndAwaitResult(workflow);

  expect(runs).toBe(1);
});

test("poll fails if a regular error is thrown", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        throw new Error("Step error");
      });
    } catch {}
  });

  await executor.runAndAwaitResult(workflow);

  expect(runs).toBe(1);
});

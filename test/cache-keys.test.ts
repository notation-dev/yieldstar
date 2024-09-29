import { beforeAll, afterAll, expect, test, mock } from "bun:test";
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

test("step.run without cache keys", async () => {
  const mock1 = mock(() => 1);
  const mock2 = mock(() => 2);

  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run(mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run(mock2);
    }
  });

  await executor.runAndAwaitResult(workflow);

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).not.toBeCalled();
});

test("step.run with cache keys", async () => {
  const mock1 = mock(() => 1);
  const mock2 = mock(() => 2);

  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run("step 1", mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run("step 2", mock2);
    }
  });

  await executor.runAndAwaitResult(workflow);

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).toBeCalledTimes(1);
});

test("step.delay without cache keys", async () => {
  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay(10);
    } else {
      yield* step.delay(10);
    }
  });

  let startTime = Date.now();

  await executor.runAndAwaitResult(workflow);

  let duration = Date.now() - startTime;

  // expect second delay to be a cache hit
  expect(duration).toBeGreaterThanOrEqual(10);
  expect(duration).toBeLessThan(15);
});

test("step.delay with cache keys", async () => {
  let executionIdx = -1;

  const workflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay("step 1", 10);
    } else {
      yield* step.delay("step 2", 10);
    }
  });

  let startTime = Date.now();

  await executor.runAndAwaitResult(workflow);

  let duration = Date.now() - startTime;

  // expect second delay to trigger a new timer
  expect(duration).toBeGreaterThanOrEqual(20);
  expect(duration).toBeLessThan(25);
});

test("interlacing cache keys and cache indexes", async () => {
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

  const result = await executor.runAndAwaitResult(workflow);

  expect(result.stableNum).toBe(2);
  expect(result.volatileNum).toBe(1);
});

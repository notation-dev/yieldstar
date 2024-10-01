import type { CompositeStepGenerator } from "yieldstar";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { createWorkflow, WorkflowEngine, RetryableError } from "yieldstar";
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

const createEngine = (workflow: CompositeStepGenerator) =>
  new WorkflowEngine({
    persister: localPersister,
    scheduler: localScheduler,
    waker: localEventLoop.waker,
    router: { "test-workflow": workflow },
  });

beforeAll(() => {
  localEventLoop.start();
});

afterAll(() => {
  localEventLoop.stop();
});

test("retrying an error for maxAttempts", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      throw new RetryableError("Step error", {
        maxAttempts: 10,
        retryInterval: 1,
      });
    });
  });

  try {
    const engine = createEngine(workflow);
    await engine.triggerAndWait("test-workflow");
  } catch {
    expect(runs).toEqual(10);
  }
});

test("retrying an for maxAttempts (irrespective of number of times error is thrown)", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      runs++;
      if (runs === 5) {
        throw new RetryableError("Step error", {
          maxAttempts: 4,
          retryInterval: 1,
        });
      }
      throw new RetryableError("Step error", {
        maxAttempts: 10,
        retryInterval: 1,
      });
    });
  });

  try {
    const engine = createEngine(workflow);
    await engine.triggerAndWait("test-workflow");
  } catch {
    expect(runs).toEqual(5);
  }
});

test("retrying an for maxAttempts (irrespective of number of number of workflow executions)", async () => {
  let runs = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        runs++;
        throw new RetryableError("Step error", {
          maxAttempts: 3,
          retryInterval: 1,
        });
      });
    } catch {}
    try {
      yield* step.run(async () => {
        runs++;
        throw new RetryableError("Step error", {
          maxAttempts: 3,
          retryInterval: 1,
        });
      });
    } catch {}
  });

  const engine = createEngine(workflow);
  await engine.triggerAndWait("test-workflow");

  expect(runs).toEqual(6);
});

test("retrying an error after retry interval", async () => {
  const executions: number[] = [];

  const workflow = createWorkflow(async function* (step) {
    yield* step.run(async () => {
      executions.push(Date.now());
      if (executions.length > 3) return;
      throw new RetryableError("Step error", {
        maxAttempts: 4,
        retryInterval: 100,
      });
    });
  });

  const engine = createEngine(workflow);
  await engine.triggerAndWait("test-workflow");
});

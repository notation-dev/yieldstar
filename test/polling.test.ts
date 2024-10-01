import type { CompositeStepGenerator } from "yieldstar";
import { beforeAll, afterAll, expect, test } from "bun:test";
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

  const engine = createEngine(workflow);
  await engine.triggerAndWait("test-workflow");

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

  const engine = createEngine(workflow);
  await engine.triggerAndWait("test-workflow");

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

  const engine = createEngine(workflow);
  await engine.triggerAndWait("test-workflow");

  expect(runs).toBe(1);
});

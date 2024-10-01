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

  const engine = createEngine(workflow);
  const result = await engine.triggerAndWait("test-workflow");

  expect(result).toBe(true);
});

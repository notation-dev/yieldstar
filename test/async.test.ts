import type { CompositeStepGenerator, WorkflowFn } from "yieldstar";
import { beforeAll, afterAll, expect, test, mock } from "bun:test";
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

test("running sync workflows to completion", async () => {
  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const engine = createEngine(workflow);

  await engine.triggerAndWait("test-workflow");

  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

test("deferring workflow execution", async () => {
  const mockWorkflowGenerator = mock(async function* (step: any) {
    let num = yield* step.run(() => {
      return 1;
    });

    yield* step.delay(5);

    num = yield* step.run(() => {
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const engine = createEngine(workflow);

  await engine.triggerAndWait("test-workflow");

  expect(mockWorkflowGenerator).toBeCalledTimes(2);
});

test("resumes workflow after a set delay", async () => {
  const workflow = createWorkflow(async function* (step: any) {
    const firstExecutionTime = yield* step.run(() => {
      return Date.now();
    });

    yield* step.delay(10);

    const secondExecutionTime = yield* step.run(() => {
      return Date.now();
    });

    return { firstExecutionTime, secondExecutionTime };
  });

  const engine = createEngine(workflow);
  const result = await engine.triggerAndWait("test-workflow");

  const delay = result.secondExecutionTime - result.firstExecutionTime;

  expect(delay).toBeGreaterThanOrEqual(10);
  // allow 5ms margin of error
  expect(delay).toBeLessThanOrEqual(15);
});

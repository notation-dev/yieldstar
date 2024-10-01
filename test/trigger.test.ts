import type { CompositeStepGenerator, WorkflowFn } from "yieldstar";
import { sleep } from "bun";
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

test("triggering a workflow", async () => {
  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (step) {
    yield* step.run(() => 1);
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const engine = createEngine(workflow);

  const { executionId } = await engine.trigger("test-workflow");

  await sleep(1);

  expect(executionId).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

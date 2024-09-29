import { sleep } from "bun";
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

test("triggering a workflow", async () => {
  const mockWorkflowGenerator = mock(async function* (step: any) {
    yield* step.run(() => 1);
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const { executionId } = await executor.trigger(workflow);

  await sleep(1);

  expect(executionId).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

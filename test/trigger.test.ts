import { sleep } from "bun";
import { beforeAll, afterAll, expect, test, mock } from "bun:test";
import { createWorkflow, Executor } from "yieldstar";
import { LocalScheduler, LocalRuntime, LocalPersister } from "yieldstar-local";

const localRuntime = new LocalRuntime();
const localPersister = new LocalPersister();

const localScheduler = new LocalScheduler({
  taskQueue: localRuntime.taskQueue,
  timers: localRuntime.timers,
});

const executor = new Executor({
  persister: localPersister,
  scheduler: localScheduler,
  waker: localRuntime.waker,
});

beforeAll(() => {
  localRuntime.start();
});

afterAll(() => {
  localRuntime.stop();
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

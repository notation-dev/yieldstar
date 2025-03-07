import type { WorkflowFn } from "yieldstar";
import { sleep } from "bun";
import { expect, test, mock } from "bun:test";
import { workflow } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";

const runner = createWorkflowTestRunner();

// todo – use sqlite runtime
test("triggering a workflow", async () => {
  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (
    step,
    event,
    logger
  ) {
    return yield* step.run(() => 1);
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const result = await runner.triggerAndWait(testWorkflow);

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

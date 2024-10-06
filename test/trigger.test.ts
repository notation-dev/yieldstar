import type { WorkflowFn } from "yieldstar";
import { sleep } from "bun";
import { expect, test, mock } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";

const runner = createWorkflowTestRunner();

// todo – use sqlite runtime
test.skip("triggering a workflow", async () => {
  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (step) {
    yield* step.run(() => 1);
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const result = await runner.triggerAndWait(workflow);

  await sleep(1);

  expect(executionId).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

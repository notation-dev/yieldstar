import type { WorkflowFn } from "yieldstar";
import { sleep } from "bun";
import { expect, test, mock } from "bun:test";
import { workflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

// todo – use sqlite runtime
test("triggering a workflow", async () => {
  const mockWorkflowGenerator = mock<WorkflowFn<any, any>>(async function* (
    step
  ) {
    return yield* step.run(() => 1);
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

import type { WorkflowFn } from "yieldstar";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test, mock } from "bun:test";
import { workflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("passing params to a workflow", async () => {
  const testParams = { foo: "bar", count: 42 };
  let capturedParams: any;

  const mockWorkflowGenerator = mock<WorkflowFn<any, any>>(async function* (
    step,
    event
  ) {
    capturedParams = event.params;
    return yield* step.run(() => event.params);
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({
    workflowId: "workflow",
    params: testParams,
  });

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
  expect(capturedParams).toEqual(testParams);
  expect(result).toEqual(testParams);
});

test("params are optional", async () => {
  let capturedParams: any;

  const mockWorkflowGenerator = mock<WorkflowFn<any, any>>(async function* (
    step,
    event
  ) {
    capturedParams = event.params;
    return yield* step.run(() => event.params || "default value");
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
  expect(capturedParams).toBeUndefined();
  expect(result).toBe("default value");
});

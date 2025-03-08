import type { WorkflowFn } from "yieldstar";
import { sleep } from "bun";
import { expect, test, mock } from "bun:test";
import { workflow } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";

const runner = createWorkflowTestRunner();

test("passing params to a workflow", async () => {
  const testParams = { foo: "bar", count: 42 };
  let capturedParams: any;
  let capturedWorkflowId: string = "";
  let capturedExecutionId: string = "";

  const mockWorkflowGenerator = mock<WorkflowFn<any, any>>(async function* (
    step,
    event
  ) {
    capturedParams = event.params;
    capturedWorkflowId = event.workflowId;
    capturedExecutionId = event.executionId;
    return yield* step.run(() => event.params);
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const result = await runner.triggerAndWait(testWorkflow, {
    params: testParams,
  });

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
  expect(capturedParams).toEqual(testParams);
  expect(capturedWorkflowId).toBe("workflow");
  expect(capturedExecutionId).toBeDefined();
  expect(result).toEqual(testParams);
});

test("params are optional", async () => {
  let capturedParams: any;
  let capturedWorkflowId: string = "";
  let capturedExecutionId: string = "";

  const mockWorkflowGenerator = mock<WorkflowFn<any, any>>(async function* (
    step,
    event
  ) {
    capturedParams = event.params;
    return yield* step.run(() => event.params || "default value");
  });

  const testWorkflow = workflow(mockWorkflowGenerator);
  const result = await runner.triggerAndWait(testWorkflow);

  await sleep(1);

  expect(result).toBeDefined();
  expect(mockWorkflowGenerator).toBeCalledTimes(1);
  expect(capturedParams).toBeUndefined();
  expect(result).toBe("default value");
});

import type { WorkflowFn } from "yieldstar";
import { sleep } from "bun";
import { expect, test, mock } from "bun:test";
import { workflow } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";

const runner = createWorkflowTestRunner();

test("passing params to a workflow", async () => {
  const testParams = { foo: "bar", count: 42 };
  let capturedParams: any;

  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (
    step,
    event,
    logger
  ) {
    capturedParams = event.params;
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
  expect(result).toEqual(testParams);
});

test("params are optional", async () => {
  let capturedParams: any;

  const mockWorkflowGenerator = mock<WorkflowFn<any>>(async function* (
    step,
    event,
    logger
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

test("backward compatibility with createWorkflow", async () => {
  const testParams = { foo: "bar", count: 42 };

  // Using the old createWorkflow API
  const oldWorkflow = workflow((step, logger) => {
    return (async function* () {
      return yield* step.run(() => "old workflow");
    })();
  });

  const result = await runner.triggerAndWait(oldWorkflow, {
    params: testParams,
  });

  expect(result).toBe("old workflow");
});

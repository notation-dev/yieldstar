import type { WorkflowFn } from "yieldstar";
import { expect, test, mock } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";
import { EventContext } from "../packages/core/dist";

const createSdk = createTestSdkFactory();

test("running sync workflows to completion", async () => {
  const mockWorkflowGenerator = mock<
    WorkflowFn<undefined, number, EventContext>
  >(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const workflow = createWorkflow(mockWorkflowGenerator);
  const sdk = createSdk({ workflow });

  await sdk.triggerAndWait({ workflowId: "workflow" });

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

  const sdk = createSdk({ workflow });
  await sdk.triggerAndWait({ workflowId: "workflow" });

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

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  const delay = result.secondExecutionTime - result.firstExecutionTime;

  expect(delay).toBeGreaterThanOrEqual(10);
  // allow 5ms margin of error
  expect(delay).toBeLessThanOrEqual(15);
});

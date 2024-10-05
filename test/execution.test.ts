import { expect, test } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createWorkflowTestRunner } from "yieldstar-test-utils";

const runner = createWorkflowTestRunner();

test("data flow between steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return num * 2;
    });

    return num;
  });

  const result = await runner.triggerAndWait(workflow);

  expect(result).toBe(2);
});

test("handling async steps", async () => {
  const workflow = createWorkflow(async function* (step) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(async () => {
      await Bun.sleep(10);
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const result = await runner.triggerAndWait(workflow);

  expect(result).toBe(2);
});

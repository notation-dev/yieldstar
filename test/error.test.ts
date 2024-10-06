import { expect, test } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createWorkflowTestRunner } from "@yieldstar/test-utils";

const runner = createWorkflowTestRunner();

test("failing steps can be caught", async () => {
  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.run(async () => {
        throw new Error("Step error");
      });
    } catch {
      return true;
    }
  });

  const result = await runner.triggerAndWait(workflow);

  expect(result).toBe(true);
});

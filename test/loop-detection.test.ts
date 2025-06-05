import { expect, test, mock } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";

const createSdk = createTestSdkFactory();

test("loop detection with implicit keys", async () => {
  const runSpy = mock(() => 1);

  const workflow = createWorkflow(async function* (step) {
    for (let i = 0; i < 2; i++) {
      yield* step.run(runSpy);
    }
  });

  const sdk = createSdk({ workflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  // The loop should be detected on the second attempt, so the function
  // backing step.run should only be executed once
  expect(runSpy).toBeCalledTimes(1);

  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toContain("Duplicate call site");
});

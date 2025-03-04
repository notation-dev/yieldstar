import type { WorkflowFn } from "yieldstar";
import { createWorkflow } from "yieldstar";

type CustomWorkflowFn<T> = (
  step: Parameters<WorkflowFn<T>>[0],
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

// essentially a custom step
const waitForStateFactory = (step: any) =>
  async function* (state: string) {
    yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => {
      console.log("Polling...");
      // check state matches
      return true;
    });
  };

const workflowFactory = (workflowFn: CustomWorkflowFn<any>) => {
  return createWorkflow(async function* (step) {
    const waitForState = waitForStateFactory(step);
    return yield* workflowFn(step, waitForState);
  });
};

export const coordinatorWorkflow = workflowFactory(async function* (
  step,
  waitForState
) {
  const a = yield* step.run(() => 2);
  yield* waitForState("enabled");
  return yield* step.run(() => a * 3);
});

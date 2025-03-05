import type { WorkflowFn } from "yieldstar";
import { createWorkflow } from "yieldstar";
import type { Logger } from "pino";
type CustomWorkflowFn<T> = (
  step: Parameters<WorkflowFn<T>>[0],
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

// essentially a custom step
const waitForStateFactory = (step: any, logger: Logger) =>
  async function* (state: string) {
    yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => {
      logger.info("Polling...");
      // check state matches
      return true;
    });
  };

const workflowFactory = (workflowFn: CustomWorkflowFn<any>) => {
  return createWorkflow(async function* (step, logger) {
    const waitForState = waitForStateFactory(step, logger);
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

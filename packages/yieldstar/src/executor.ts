import type { StepPersister } from "./step-persister";
import { StepDelay, WorkflowResult } from "./step-response";
import type { CompositeStepGenerator } from "./workflow";

/**
 * @description Runs the workflow to completion, awaiting the final result
 */
export async function runToCompletion<T>(params: {
  executionId: string;
  persister: StepPersister;
  workflow: CompositeStepGenerator<T>;
}): Promise<T> {
  const { executionId, persister, workflow } = params;

  const workflowIterator = workflow({
    persister,
    executionId: executionId,
  });

  const iteratorResult = await workflowIterator.next();
  const stageResponse = iteratorResult.value;

  if (iteratorResult.done) {
    return (stageResponse as WorkflowResult<T>).result;
  }

  if (stageResponse instanceof StepDelay) {
    await Bun.sleep(stageResponse.resumeAt - Date.now());
    return runToCompletion(params);
  }

  throw new Error("Critical error");
}

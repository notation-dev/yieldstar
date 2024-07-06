import type { StepPersister } from "./step-persister";
import type { CompositeStepGenerator } from "./workflow";
import { StepDelay, WorkflowDelay, WorkflowResult } from "./step-response";

/**
 * @description Runs the workflow to completion, awaiting the final result
 */
export async function runCompositeSteps<T>(params: {
  executionId: string;
  persister: StepPersister;
  workflow: CompositeStepGenerator<T>;
}): Promise<WorkflowResult<T> | WorkflowDelay> {
  // does this workflow execution already exists?
  // no: create workflow execution
  const { executionId, persister, workflow } = params;

  // initialise composite step runner
  const workflowIterator = workflow({ persister, executionId });

  const iteratorResult = await workflowIterator.next();
  const stageResponse = iteratorResult.value;

  if (iteratorResult.done) {
    return stageResponse as WorkflowResult<T>;
  }

  if (stageResponse instanceof StepDelay) {
    return new WorkflowDelay(stageResponse.resumeAt - Date.now());
  }

  throw new Error("Critical error");
}

export async function runToCompletion<T>(params: {
  executionId: string;
  persister: StepPersister;
  workflow: CompositeStepGenerator<T>;
}): Promise<T> {
  let stageResponse = await runCompositeSteps(params);
  if (stageResponse instanceof WorkflowDelay) {
    const { resumeAt } = stageResponse;
    await new Promise((resolve) => setTimeout(resolve, resumeAt));
    return runToCompletion(params);
  }
  return stageResponse.result;
}

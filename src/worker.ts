import type { Connector } from "./connector";
import { StepDelay, WorkflowResult } from "./step-response";
import type { CompositeStepGenerator } from "./workflow";

/**
 * @description Runs the workflow to completion, awaiting the final result
 */
export async function runToCompletion(params: {
  executionId: string;
  connector: Connector;
  workflow: CompositeStepGenerator;
}): Promise<any> {
  const { executionId, connector, workflow } = params;
  const workflowIterator = workflow({
    connector,
    executionId: executionId,
  });
  const iteratorResult = await workflowIterator.next();
  const stageResponse = iteratorResult.value;

  if (iteratorResult.done) {
    return (stageResponse as WorkflowResult).result;
  }

  if (stageResponse instanceof StepDelay) {
    await Bun.sleep(stageResponse.resumeAt - Date.now());
    return runToCompletion(params);
  }
}

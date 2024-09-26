import type { StepPersister } from "./step-persister";
import type { CompositeStepGenerator } from "./workflow";
import { StepDelay, WorkflowDelay, WorkflowResult } from "./step-response";

export type Scheduler = (ts: number) => Promise<void>;

export class Executor {
  private persister: StepPersister;
  private scheduler: Scheduler;

  constructor(params: { persister: StepPersister; scheduler: Scheduler }) {
    this.persister = params.persister;
    this.scheduler = params.scheduler;
  }

  private async runCompositeSteps<T>(params: {
    executionId: string;
    workflow: CompositeStepGenerator<T>;
  }): Promise<WorkflowResult<T> | WorkflowDelay> {
    // todo: does this workflow execution already exists?
    // no: create workflow execution
    const { executionId, workflow } = params;

    // initialise composite step runner
    const workflowIterator = workflow({
      persister: this.persister,
      executionId,
    });

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

  async runAndAwaitResult<T>(params: {
    executionId: string;
    workflow: CompositeStepGenerator<T>;
  }): Promise<T> {
    let stageResponse = await this.runCompositeSteps(params);
    if (stageResponse instanceof WorkflowDelay) {
      const { resumeAt } = stageResponse;
      await this.scheduler(resumeAt);
      return this.runAndAwaitResult(params);
    }
    return stageResponse.result;
  }
}

import type {
  CompositeStepGenerator,
  StepPersister,
  TaskProcessor,
} from "../types";
import {
  StepDelay,
  WorkflowDelay,
  WorkflowResult,
} from "../base/step-response";
import type { Scheduler } from "../base/scheduler";

export class WorkflowRunner<
  Router extends Record<string, CompositeStepGenerator<any>>
> {
  private persister: StepPersister;
  private scheduler: Scheduler;
  private router: Router;

  constructor(params: {
    persister: StepPersister;
    scheduler: Scheduler;
    router: Router;
  }) {
    this.persister = params.persister;
    this.scheduler = params.scheduler;
    this.router = params.router;
  }

  run: TaskProcessor = async (task) => {
    const { workflowId, executionId } = task;
    const workflow = this.router[workflowId];

    if (!workflow) {
      throw new Error(`No workflow registered for "${workflowId}"`);
    }

    try {
      const response = await this.runCompositeSteps({ executionId, workflow });

      switch (response.type) {
        case "workflow-result":
          return response.result;

        case "workflow-delay":
          this.scheduler.requestWakeUp({
            workflowId,
            executionId,
            resumeIn: response.resumeIn,
          });
          break;
      }
    } catch (err) {
      // todo: distinguish between a workflow error and a system error
      throw err;
    }
  };

  private async runCompositeSteps<T>(params: {
    executionId: string;
    workflow: CompositeStepGenerator<T>;
  }): Promise<WorkflowResult<T> | WorkflowDelay> {
    const { executionId, workflow } = params;

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
      return new WorkflowDelay(stageResponse.resumeIn - Date.now());
    }

    throw new Error("Critical error");
  }
}

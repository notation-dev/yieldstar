import type { Logger } from "pino";
import type {
  WorkflowGenerator,
  HeapClient,
  SchedulerClient,
  EventProcessor,
  WorkflowEvent,
} from "..";
import { StepDelay, WorkflowDelay, WorkflowResult } from "..";

export class WorkflowRunner<
  Router extends Record<string, WorkflowGenerator<any, any, any>>
> {
  private heapClient: HeapClient;
  private schedulerClient: SchedulerClient;
  private router: Router;

  constructor(params: {
    heapClient: HeapClient;
    schedulerClient: SchedulerClient;
    router: Router;
    logger: Logger;
  }) {
    this.heapClient = params.heapClient;
    this.schedulerClient = params.schedulerClient;
    this.router = params.router;
  }

  run: EventProcessor<any, any> = async (event, logger) => {
    const workflow = this.router[event.workflowId];

    if (!workflow) {
      throw new Error(`No workflow registered for "${event.workflowId}"`);
    }

    try {
      const response = await this.runWorkflows({
        workflow,
        logger,
        event,
      });

      switch (response.type) {
        case "workflow-result":
          return response;

        case "workflow-delay":
          this.schedulerClient.requestWakeUp(event, response.resumeIn);
          break;
      }
    } catch (err) {
      // todo: distinguish between a workflow error and a system error
      throw err;
    }
  };

  private async runWorkflows<
    EventParams,
    Result,
    Context extends Map<any, any>
  >(params: {
    workflow: WorkflowGenerator<EventParams, Result, Context>;
    event: WorkflowEvent<EventParams, Context>;
    logger: Logger;
  }): Promise<WorkflowResult<Result> | WorkflowDelay> {
    const { workflow, event, logger } = params;

    const workflowIterator = workflow({
      event,
      heapClient: this.heapClient,
      logger,
    });

    const iteratorResult = await workflowIterator.next();
    const stageResponse = iteratorResult.value;

    if (iteratorResult.done) {
      return stageResponse as WorkflowResult<Result>;
    }

    if (stageResponse instanceof StepDelay) {
      return new WorkflowDelay(stageResponse.resumeIn - Date.now());
    }

    throw new Error(
      "Workflow runner critical error. This is likely because your worklow and worker are referencing different versions of @yieldstar/core."
    );
  }
}

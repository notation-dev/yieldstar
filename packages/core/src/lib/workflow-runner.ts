import type { Logger } from "pino";
import type {
  WorkflowGenerator,
  HeapClient,
  SchedulerClient,
  StoreClient,
  EventProcessor,
  WorkflowEvent,
  EventParams,
} from "..";
import { StepDelay, StepStoreWait, WorkflowDelay, WorkflowResult } from "..";
import { EventContext } from "../base/event";

export class WorkflowRunner<
  Router extends Record<string, WorkflowGenerator<any, any, any>>
> {
  private heapClient: HeapClient;
  private schedulerClient: SchedulerClient;
  private storeClient: StoreClient;
  private router: Router;

  constructor(params: {
    heapClient: HeapClient;
    schedulerClient: SchedulerClient;
    storeClient: StoreClient;
    router: Router;
    logger: Logger;
  }) {
    this.heapClient = params.heapClient;
    this.schedulerClient = params.schedulerClient;
    this.storeClient = params.storeClient;
    this.router = params.router;
  }

  run: EventProcessor = async (event, logger) => {
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

        case "store-wait":
          break;
      }
    } catch (err) {
      // todo: distinguish between a workflow error and a system error
      throw err;
    }
  };

  private async runWorkflows<
    Params extends EventParams,
    Result,
    Context extends EventContext
  >(params: {
    workflow: WorkflowGenerator<Params, Result, Context>;
    event: WorkflowEvent<Params, Context>;
    logger: Logger;
  }): Promise<WorkflowResult<Result> | WorkflowDelay | StepStoreWait> {
    const { workflow, event, logger } = params;

    const workflowIterator = workflow({
      event,
      heapClient: this.heapClient,
      storeClient: this.storeClient,
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

    if (stageResponse instanceof StepStoreWait) {
      return stageResponse;
    }

    throw new Error(
      "Workflow runner critical error. This is likely because your worklow and worker are referencing different versions of @yieldstar/core."
    );
  }
}

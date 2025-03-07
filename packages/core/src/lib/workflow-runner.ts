import type { Logger } from "pino";
import type {
  WorkflowGenerator,
  HeapClient,
  SchedulerClient,
  TaskProcessor,
  ExecutionEvent,
} from "..";
import { StepDelay, WorkflowDelay, WorkflowResult } from "..";

export class WorkflowRunner<
  Router extends Record<string, WorkflowGenerator<any>>
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

  run: TaskProcessor = async (event, logger) => {
    const { workflowId, executionId, params } = event;
    const workflow = this.router[workflowId];

    if (!workflow) {
      throw new Error(`No workflow registered for "${workflowId}"`);
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
          this.schedulerClient.requestWakeUp(
            { workflowId, executionId, params },
            response.resumeIn
          );
          break;
      }
    } catch (err) {
      // todo: distinguish between a workflow error and a system error
      throw err;
    }
  };

  private async runWorkflows<T>(params: {
    workflow: WorkflowGenerator<T>;
    event: ExecutionEvent;
    logger: Logger;
  }): Promise<WorkflowResult<T> | WorkflowDelay> {
    const { workflow, event, logger } = params;

    const workflowIterator = workflow({
      heapClient: this.heapClient,
      workflowId: event.workflowId,
      executionId: event.executionId,
      params: event.params,
      logger,
    });

    const iteratorResult = await workflowIterator.next();
    const stageResponse = iteratorResult.value;

    if (iteratorResult.done) {
      return stageResponse as WorkflowResult<T>;
    }

    if (stageResponse instanceof StepDelay) {
      return new WorkflowDelay(stageResponse.resumeIn - Date.now());
    }

    throw new Error("Workflow runner critical error");
  }
}

import type { StepPersister } from "./step-persister";
import type { CompositeStepGenerator } from "./workflow";
import { randomUUID } from "crypto";
import { StepDelay, WorkflowDelay, WorkflowResult } from "./step-response";

export type Task = { workflowId: string; executionId: string };

export interface Scheduler {
  requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn: number;
  }): Promise<void>;
}

export interface Waker {
  onWakeUp(subscriber: WakeUpHandler): void;
}

export type WakeUpHandler = (task: Task) => void | Promise<void>;

export class Executor {
  private persister: StepPersister;
  private scheduler: Scheduler;
  private waker: Waker;
  private workflows: Map<string, CompositeStepGenerator>;
  private workflowEndSubscribers: Map<string, (err: any, result: any) => void>;

  constructor(params: {
    persister: StepPersister;
    scheduler: Scheduler;
    waker: Waker;
  }) {
    this.persister = params.persister;
    this.scheduler = params.scheduler;
    this.waker = params.waker;
    this.workflows = new Map();
    this.workflowEndSubscribers = new Map();
    this.waker.onWakeUp(this.handleWakeUpCall);
  }

  async trigger(workflow: CompositeStepGenerator) {
    const workflowId = randomUUID();
    const executionId = randomUUID();

    this.workflows.set(workflowId, workflow);

    await this.scheduler.requestWakeUp({
      workflowId,
      executionId,
      resumeIn: 0,
    });

    return { executionId };
  }

  async runAndAwaitResult<T>(
    workflow: CompositeStepGenerator<T>,
    timeout: number = 5000
  ): Promise<T> {
    const { executionId } = await this.trigger(workflow);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject("Timer expired"), timeout);
      this.onWorkflowEnd(executionId, (err, result) => {
        clearTimeout(timer);
        if (err) {
          reject(err);
        } else {
          resolve(result as T);
        }
      });
    });
  }

  private handleWakeUpCall = async (task: Task) => {
    const { workflowId, executionId } = task;
    const workflow = this.getWorkflow(workflowId);
    const workflowEndSubscriber = this.workflowEndSubscribers.get(executionId);

    try {
      const response = await this.runCompositeSteps({ executionId, workflow });

      switch (response.type) {
        case "workflow-result":
          this.workflows.delete(workflowId);
          if (workflowEndSubscriber) {
            workflowEndSubscriber(null, response.result);
            this.workflowEndSubscribers.delete(executionId);
          }
          break;

        case "workflow-delay":
          this.scheduler.requestWakeUp({
            workflowId,
            executionId,
            resumeIn: response.resumeIn,
          });
          break;
      }
    } catch (err) {
      this.workflows.delete(workflowId);
      if (workflowEndSubscriber) {
        workflowEndSubscriber(err, null);
        this.workflowEndSubscribers.delete(executionId);
      }
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

  private onWorkflowEnd(
    executionId: string,
    subscriber: (err: any, result: any) => void
  ) {
    this.workflowEndSubscribers.set(executionId, subscriber);
  }

  private getWorkflow(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    return workflow;
  }
}

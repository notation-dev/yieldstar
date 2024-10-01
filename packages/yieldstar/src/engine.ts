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

export type WakeUpHandler = (task: Task, done: () => void) => void;

type ReturnTypeOfCompositeStepGenerator<CG> = CG extends CompositeStepGenerator<
  infer T
>
  ? T
  : never;

export class WorkflowEngine<
  Router extends Record<string, CompositeStepGenerator<any>>
> {
  private persister: StepPersister;
  private scheduler: Scheduler;
  private waker: Waker;
  private executionEndSubscribers: Map<string, (err: any, result: any) => void>;
  private router: Router;

  constructor(params: {
    persister: StepPersister;
    scheduler: Scheduler;
    waker: Waker;
    router: Router;
  }) {
    this.persister = params.persister;
    this.scheduler = params.scheduler;
    this.waker = params.waker;
    this.router = params.router;
    this.executionEndSubscribers = new Map();
    this.waker.onWakeUp(this.handleWakeUpCall);
  }

  // todo: if executionId is passed, dedupe execution by executionId
  // and replay workflow (with cached values)
  async trigger<K extends keyof Router & string>(
    workflowId: K,
    params?: { executionId?: string }
  ) {
    const executionId = params?.executionId ?? randomUUID();
    await this.scheduler.requestWakeUp({
      workflowId,
      executionId,
      resumeIn: 0,
    });
    return { executionId };
  }

  async triggerAndWait<K extends keyof Router & string>(
    workflowId: K,
    params?: { executionId?: string; timeout?: number }
  ): Promise<ReturnTypeOfCompositeStepGenerator<Router[K]>> {
    let { executionId } = await this.trigger(workflowId, {
      executionId: params?.executionId,
    });
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(
        () => reject("Timer expired"),
        params?.timeout ?? 150000
      );
      this.onceExecutionEnd(executionId, (err, result) => {
        clearTimeout(timeoutTimer);
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  private onceExecutionEnd(
    executionId: string,
    subscriber: (err: any, result: any) => void
  ) {
    this.executionEndSubscribers.set(executionId, subscriber);
  }

  private handleWakeUpCall: WakeUpHandler = async (task, done) => {
    const { workflowId, executionId } = task;
    const workflow = this.router[workflowId];
    const executionEndSubscriber =
      this.executionEndSubscribers.get(executionId);

    try {
      const response = await this.runCompositeSteps({ executionId, workflow });

      switch (response.type) {
        case "workflow-result":
          if (executionEndSubscriber) {
            executionEndSubscriber(null, response.result);
            this.executionEndSubscribers.delete(executionId);
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
      // todo: distinguish between a workflow error and a system error

      if (executionEndSubscriber) {
        executionEndSubscriber(err, null);
        this.executionEndSubscribers.delete(executionId);
      }
    } finally {
      // Acknowledge to the distributed runtime that the task was processed
      // if we don't end up here (probably because of a fatal error),
      // the distributed runtime will send a wake up call again (n times).
      // Steps will still only be run exactly once (as their output is persisted),
      // but the workflow will be replayed so subscribers can receive the workflow result
      done();
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

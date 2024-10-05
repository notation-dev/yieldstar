import type { StepPersister } from "./base/step-persister";
import type { StepResponse, WorkflowResult } from "./base/step-response";
import type { StepRunner } from "./core/step-runner";

export type Task = { workflowId: string; executionId: string; params?: any };

export type WorkflowRouter = Record<string, CompositeStepGenerator>;

export type WorkflowFn<T> = (step: StepRunner) => AsyncGenerator<any, T>;

export type CompositeStepGenerator<T = any> = (params: {
  executionId: string;
  persister: StepPersister;
}) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

export type CompositeStepGeneratorReturnType<CG> =
  CG extends CompositeStepGenerator<infer T> ? T : never;

export type { TaskProcessor } from "./core/workflow-runner";
export type { CacheResponse, StepPersister } from "./base/step-persister";
export type { StepRunner } from "./core/step-runner";
export type { Scheduler } from "./base/scheduler";

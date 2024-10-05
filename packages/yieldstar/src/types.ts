import type { StepPersister } from "./base/step-persister";
import type { StepResponse, WorkflowResult } from "./base/step-response";
import type { StepRunner } from "./core/step-runner";

// Base types
export type * from "./base/manager";
export type * from "./base/runtime";
export type * from "./base/scheduler";
export type * from "./base/step-persister";
export type * from "./base/step-response";

// Derived Types
export type CompositeStepGenerator<T = any> = (params: {
  executionId: string;
  persister: StepPersister;
}) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

export type CompositeStepGeneratorReturnType<CG> =
  CG extends CompositeStepGenerator<infer T> ? T : never;

export type WorkflowRouter = Record<string, CompositeStepGenerator>;

export type WorkflowFn<T> = (step: StepRunner) => AsyncGenerator<any, T>;

export type { StepRunner } from "./core/step-runner";

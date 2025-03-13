import { FreezableMap } from "../utils/map";

export type EventParams = Record<string, any> | void;
export type EventContext = ReadonlyMap<any, any>;
export type MiddlewareEventContext = FreezableMap<any, any>;

export type TriggerEvent<
  WorkflowId extends string,
  Params extends EventParams = EventParams
> = Params extends void
  ? {
      workflowId: WorkflowId;
      executionId?: string;
      params?: undefined;
    }
  : {
      workflowId: WorkflowId;
      executionId?: string;
      params: Params;
    };

export type ExecutionEvent<Params extends EventParams = EventParams> = {
  workflowId: string;
  executionId: string;
  params: Params;
};

export type WorkflowEvent<
  Params extends EventParams = EventParams,
  Context extends ReadonlyMap<any, any> = ReadonlyMap<any, any>
> = {
  workflowId: string;
  executionId: string;
  params: Params;
  context: Context;
};

export type MiddlewareEvent<
  Params extends EventParams = EventParams,
  Context extends MiddlewareEventContext = MiddlewareEventContext
> = ExecutionEvent<Params> & {
  context: Context;
};

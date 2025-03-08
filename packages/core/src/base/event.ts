export type TriggerEvent<
  WorkflowId extends string,
  EventParams = any
> = EventParams extends void
  ? {
      workflowId: WorkflowId;
      executionId?: string;
      params?: undefined;
    }
  : {
      workflowId: WorkflowId;
      executionId?: string;
      params: EventParams;
    };

export type ExecutionEvent<EventParams = any> = {
  workflowId: string;
  executionId: string;
  params: EventParams;
};

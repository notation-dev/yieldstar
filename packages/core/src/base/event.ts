/**
 * The event object that a user passes when triggering a workflow.
 */
export type TriggerEvent<
  Params extends Record<string, unknown> = Record<string, unknown>
> = {
  /**
   * Optional execution ID for the workflow. If not provided, a random UUID will be generated.
   */
  executionId?: string;

  /**
   * Optional parameters to pass to the workflow.
   */
  params?: Params;
};

/**
 * The event object that a workflow receives when it is executed.
 */
export type ExecutionEvent<
  Params extends Record<string, unknown> = Record<string, unknown>
> = {
  /**
   * The ID of the workflow to execute.
   */
  workflowId: string;

  /**
   * The unique execution ID for this workflow run.
   */
  executionId: string;

  /**
   * Optional parameters passed to the workflow.
   */
  params?: Params;
};

export interface SchedulerClient {
  requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn: number;
  }): Promise<void>;
}

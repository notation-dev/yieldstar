export interface Scheduler {
  requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn: number;
  }): Promise<void>;
}

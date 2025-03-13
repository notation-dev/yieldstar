import type { WorkflowEvent, EventParams } from "./event";

export interface SchedulerClient {
  requestWakeUp<Params extends EventParams>(
    event: WorkflowEvent<Params>,
    resumeIn?: number
  ): Promise<void>;
}

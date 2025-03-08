import type { ExecutionEvent } from "./event";

export interface SchedulerClient {
  requestWakeUp<EventParams>(
    event: ExecutionEvent<EventParams>,
    resumeIn?: number
  ): Promise<void>;
}

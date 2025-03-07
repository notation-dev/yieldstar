import type { ExecutionEvent } from "./event";

export interface SchedulerClient {
  requestWakeUp(params: ExecutionEvent, resumeIn?: number): Promise<void>;
}

import type { Scheduler } from "yieldstar";
import type { LocalTaskQueue, LocalTimers } from "./local-event-loop";

export class LocalScheduler implements Scheduler {
  private taskQueue: LocalTaskQueue;
  private timers: LocalTimers;

  constructor(params: { taskQueue: LocalTaskQueue; timers: LocalTimers }) {
    this.taskQueue = params.taskQueue;
    this.timers = params.timers;
  }

  async requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn?: number;
  }) {
    const { resumeIn, ...task } = params;
    if (!resumeIn) {
      this.taskQueue.add(task);
      return;
    }
    this.timers.startTimer({
      duration: resumeIn,
      workflowId: params.workflowId,
      executionId: params.executionId,
    });
  }
}

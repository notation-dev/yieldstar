import type { SchedulerClient } from "@yieldstar/core";
import type { MemoryTaskQueue } from "./memory-task-queue";
import type { MemoryTimers } from "./memory-timers";
import type { MemoryEventLoop } from "./memory-event-loop";

export class MemorySchedulerClient implements SchedulerClient {
  private taskQueue: MemoryTaskQueue;
  private timers: MemoryTimers;

  constructor(eventLoop: MemoryEventLoop) {
    this.taskQueue = eventLoop.taskQueue;
    this.timers = eventLoop.timers;
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

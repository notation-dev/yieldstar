import type { WorkflowEvent, SchedulerClient } from "@yieldstar/core";
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

  async requestWakeUp(event: WorkflowEvent, resumeIn?: number) {
    if (!resumeIn) {
      this.taskQueue.add(event);
      return;
    }
    this.timers.startTimer(event, resumeIn);
  }
}

import type { MemoryTaskQueue } from "./memory-task-queue";

export class MemoryTimers {
  private taskQueue: MemoryTaskQueue;
  private timers: Set<Timer>;

  constructor(params: { taskQueue: MemoryTaskQueue }) {
    this.taskQueue = params.taskQueue;
    this.timers = new Set();
  }

  startTimer(params: {
    duration: number;
    workflowId: string;
    executionId: string;
  }) {
    const { duration, ...task } = params;
    const timer = setTimeout(() => {
      this.taskQueue.add(task);
      this.timers.delete(timer);
    }, duration);
    this.timers.add(timer);
  }

  get isEmpty(): boolean {
    return this.timers.size === 0;
  }
}

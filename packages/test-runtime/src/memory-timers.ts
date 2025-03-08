import type { ExecutionEvent } from "@yieldstar/core";
import type { MemoryTaskQueue } from "./memory-task-queue";

export class MemoryTimers {
  private taskQueue: MemoryTaskQueue;
  private timers: Set<Timer>;

  constructor(params: { taskQueue: MemoryTaskQueue }) {
    this.taskQueue = params.taskQueue;
    this.timers = new Set();
  }

  startTimer(event: ExecutionEvent, duration: number) {
    const timer = setTimeout(() => {
      this.taskQueue.add(event);
      this.timers.delete(timer);
    }, duration);

    this.timers.add(timer);
  }

  get isEmpty(): boolean {
    return this.timers.size === 0;
  }
}

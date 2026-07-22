import type { WorkflowEvent } from "@yieldstar/core";
import type { MemoryTaskQueue } from "./memory-task-queue";

export class MemoryTimers {
  private taskQueue: MemoryTaskQueue;
  private timers: Set<ReturnType<typeof setTimeout>>;

  constructor(params: { taskQueue: MemoryTaskQueue }) {
    this.taskQueue = params.taskQueue;
    this.timers = new Set();
  }

  startTimer(event: WorkflowEvent, duration: number) {
    const timer = setTimeout(() => {
      this.taskQueue.add(event);
      this.timers.delete(timer);
    }, duration);

    this.timers.add(timer);
  }

  get isEmpty(): boolean {
    return this.timers.size === 0;
  }

  clear() {
    this.timers.clear();
  }
}

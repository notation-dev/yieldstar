import type { TaskProcessor } from "@yieldstar/core";
import { MemoryTaskQueue } from "./memory-task-queue";
import { MemoryTimers } from "./memory-timers";

export class MemoryEventLoop {
  private isRunning: boolean = false;
  taskQueue: MemoryTaskQueue;
  timers: MemoryTimers;

  constructor() {
    this.taskQueue = new MemoryTaskQueue();
    this.timers = new MemoryTimers({ taskQueue: this.taskQueue });
  }

  start(params: { onNewTask: TaskProcessor }) {
    this.isRunning = true;
    this.loop(params.onNewTask);
  }

  stop() {
    this.isRunning = false;
  }

  private async loop(processTask: TaskProcessor) {
    if (!this.isRunning) return;
    while (!this.taskQueue.isEmpty) {
      const task = this.taskQueue.process();
      if (task) {
        await processTask(task);
        this.taskQueue.remove(task.taskId);
      }
    }
    setTimeout(() => this.loop(processTask), 0);
  }
}

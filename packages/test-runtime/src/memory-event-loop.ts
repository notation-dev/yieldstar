import type { Logger } from "pino";
import type { EventProcessor } from "@yieldstar/core";
import { MemoryTaskQueue } from "./memory-task-queue";
import { MemoryTimers } from "./memory-timers";

export class MemoryEventLoop {
  private isRunning: boolean = false;
  taskQueue: MemoryTaskQueue;
  timers: MemoryTimers;
  logger: Logger;

  constructor(logger: Logger) {
    this.taskQueue = new MemoryTaskQueue();
    this.timers = new MemoryTimers({ taskQueue: this.taskQueue });
    this.logger = logger;
  }

  start(params: { onNewEvent: EventProcessor }) {
    this.isRunning = true;
    this.loop(params.onNewEvent);
  }

  stop() {
    this.isRunning = false;
  }

  private async loop(processEvent: EventProcessor) {
    if (!this.isRunning) return;
    while (!this.taskQueue.isEmpty) {
      const task = this.taskQueue.process();
      if (task) {
        await processEvent(task.event, this.logger);
        this.taskQueue.remove(task.taskId);
      }
    }
    setTimeout(() => this.loop(processEvent), 0);
  }
}

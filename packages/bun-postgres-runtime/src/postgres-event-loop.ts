import type { SQL } from "bun";
import { PostgresTaskQueue } from "./postgres-task-queue";
import { PostgresTimers } from "./postgres-timers";
import type { EventProcessor } from "@yieldstar/core";
import type { Logger } from "pino";

export class PostgresEventLoop {
  taskQueue: PostgresTaskQueue;
  timers: PostgresTimers;
  private isRunning: boolean = false;

  constructor(sql: SQL) {
    this.taskQueue = new PostgresTaskQueue(sql);
    this.timers = new PostgresTimers({ sql, taskQueue: this.taskQueue });
  }

  start(params: { onNewEvent: EventProcessor; logger: Logger }) {
    this.isRunning = true;
    this.loop(params.onNewEvent, params.logger);
  }

  stop() {
    this.isRunning = false;
  }

  private async loop(processEvent: EventProcessor, logger: Logger) {
    if (!this.isRunning) return;

    while (!(await this.taskQueue.isEmpty())) {
      const task = await this.taskQueue.process();
      if (task) {
        await processEvent(task.event, logger);
        await this.taskQueue.remove(task.taskId);
      }
    }

    await this.timers.processTimers();

    setTimeout(() => this.loop(processEvent, logger), 10);
  }
}

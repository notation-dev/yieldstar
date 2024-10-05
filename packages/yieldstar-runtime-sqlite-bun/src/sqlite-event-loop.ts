import { Database } from "bun:sqlite";
import { SqliteTaskQueue } from "./sqlite-task-queue";
import { SqliteTimers } from "./sqlite-timers";
import type { TaskProcessor } from "yieldstar";

export class SqliteEventLoop {
  taskQueue: SqliteTaskQueue;
  timers: SqliteTimers;
  private isRunning: boolean = false;

  constructor(db: Database) {
    this.taskQueue = new SqliteTaskQueue(db);
    this.timers = new SqliteTimers({ db, taskQueue: this.taskQueue });
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

    this.timers.processTimers();

    setTimeout(() => this.loop(processTask), 10);
  }
}

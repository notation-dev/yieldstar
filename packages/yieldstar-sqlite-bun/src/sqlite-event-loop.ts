import { Database } from "bun:sqlite";
import { SqliteTaskQueue } from "./sqlite-task-queue";
import { SqliteTimers } from "./sqlite-timers";
import type { Waker, WakeUpHandler, Task } from "yieldstar";

export class SqliteEventLoop {
  taskQueue: SqliteTaskQueue;
  timers: SqliteTimers;
  waker: SqliteWaker;
  private isRunning: boolean = false;

  constructor(db: Database) {
    this.waker = new SqliteWaker();
    this.taskQueue = new SqliteTaskQueue(db);
    this.timers = new SqliteTimers({ db, taskQueue: this.taskQueue });
  }

  start() {
    this.isRunning = true;
    this.loop();
  }

  stop() {
    this.isRunning = false;
  }

  private loop() {
    if (!this.isRunning) return;
    while (!this.taskQueue.isEmpty) {
      const task = this.taskQueue.remove();
      if (task) {
        this.waker.wakeUp(task);
      }
    }
    setImmediate(() => this.loop());
  }
}

export class SqliteWaker implements Waker {
  private subscribers: WakeUpHandler[] = [];

  onWakeUp(subscriber: WakeUpHandler) {
    this.subscribers.push(subscriber);
  }

  wakeUp(task: Task) {
    for (const subscriber of this.subscribers) {
      subscriber(task);
    }
  }
}

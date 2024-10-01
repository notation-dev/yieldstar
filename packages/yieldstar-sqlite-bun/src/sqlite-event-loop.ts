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

    while (this.waker.hasSubscriber && !this.taskQueue.isEmpty) {
      const task = this.taskQueue.process();
      if (task) {
        this.waker.wakeUp(task, () => {
          this.taskQueue.remove(task.taskId);
        });
      }
    }

    setTimeout(() => this.loop(), 10);
  }
}

export class SqliteWaker implements Waker {
  private subscriber: WakeUpHandler | null = null;

  onWakeUp(subscriber: WakeUpHandler) {
    this.subscriber = subscriber;
  }

  get hasSubscriber() {
    return !!this.subscriber;
  }

  async wakeUp(task: Task, done: () => void) {
    if (!this.subscriber) return;
    this.subscriber(task, done);
  }
}

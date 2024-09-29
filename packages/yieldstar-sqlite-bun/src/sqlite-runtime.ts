import { Database } from "bun:sqlite";
import { SqliteTaskQueue } from "./sqlite-task-queue";
import { SqliteTimers } from "./sqlite-timers";
import type { Waker, WakeUpHandler, Task } from "yieldstar";

export class SqliteRuntime {
  private eventLoop: SqliteEventLoop;
  taskQueue: SqliteTaskQueue;
  timers: SqliteTimers;
  waker: SqliteWaker;

  constructor(db: Database) {
    this.waker = new SqliteWaker();
    this.taskQueue = new SqliteTaskQueue(db);
    this.timers = new SqliteTimers({ db, taskQueue: this.taskQueue });
    this.eventLoop = new SqliteEventLoop({
      taskQueue: this.taskQueue,
      waker: this.waker,
    });
  }

  start() {
    this.eventLoop.start();
  }

  stop() {
    this.eventLoop.stop();
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

export class SqliteEventLoop {
  private taskQueue: SqliteTaskQueue;
  private waker: SqliteWaker;
  private isRunning: boolean = false;

  constructor(params: { taskQueue: SqliteTaskQueue; waker: SqliteWaker }) {
    this.taskQueue = params.taskQueue;
    this.waker = params.waker;
  }

  start() {
    this.isRunning = true;
    this.loop();
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

  stop() {
    this.isRunning = false;
  }
}

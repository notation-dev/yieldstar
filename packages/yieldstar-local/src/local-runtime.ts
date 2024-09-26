import type { Task, Waker } from "yieldstar";
import type { LocalWaker } from "./local-waker";

export class LocalRuntime {
  private waker: LocalWaker;
  taskQueue: LocalTaskQueue;
  timers: LocalTimers;
  private eventLoop: LocalEventLoop;

  constructor(waker: LocalWaker) {
    this.waker = waker;
    this.taskQueue = new LocalTaskQueue();
    this.timers = new LocalTimers({ taskQueue: this.taskQueue });
    this.eventLoop = new LocalEventLoop({
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

export class LocalEventLoop {
  private taskQueue: LocalTaskQueue;
  private waker: LocalWaker;
  private isRunning: boolean = false;

  constructor(params: { taskQueue: LocalTaskQueue; waker: LocalWaker }) {
    this.taskQueue = params.taskQueue;
    this.waker = params.waker;
  }

  start() {
    this.isRunning = true;
    this.loop();
  }

  private loop() {
    if (!this.isRunning) return;
    while (!this.taskQueue.isEmpty()) {
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

export class LocalTimers {
  private taskQueue: LocalTaskQueue;

  constructor(params: { taskQueue: LocalTaskQueue }) {
    this.taskQueue = params.taskQueue;
  }

  startTimer(params: {
    duration: number;
    workflowId: string;
    executionId: string;
  }) {
    const { duration, ...task } = params;
    setTimeout(() => {
      this.taskQueue.add(task);
    }, duration);
  }
}

export class LocalTaskQueue {
  private queue: Task[] = [];

  add(task: Task) {
    this.queue.push(task);
  }

  remove(): Task | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

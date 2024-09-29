import type { Task, Waker, WakeUpHandler } from "yieldstar";

export class LocalEventLoop {
  private isRunning: boolean = false;
  taskQueue: LocalTaskQueue;
  timers: LocalTimers;
  waker: LocalWaker;

  constructor() {
    this.waker = new LocalWaker();
    this.taskQueue = new LocalTaskQueue();
    this.timers = new LocalTimers({ taskQueue: this.taskQueue });
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

export class LocalWaker implements Waker {
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

export class LocalTimers {
  private taskQueue: LocalTaskQueue;
  private timers: Set<Timer>;

  constructor(params: { taskQueue: LocalTaskQueue }) {
    this.taskQueue = params.taskQueue;
    this.timers = new Set();
  }

  startTimer(params: {
    duration: number;
    workflowId: string;
    executionId: string;
  }) {
    const { duration, ...task } = params;
    const timer = setTimeout(() => {
      this.taskQueue.add(task);
      this.timers.delete(timer);
    }, duration);
    this.timers.add(timer);
  }

  get isEmpty(): boolean {
    console.log(this.timers.size);
    return this.timers.size === 0;
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

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

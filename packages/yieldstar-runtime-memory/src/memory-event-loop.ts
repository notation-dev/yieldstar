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
    while (this.waker.hasSubscriber && !this.taskQueue.isEmpty) {
      const task = this.taskQueue.process();
      if (task) {
        this.waker.wakeUp(task, () => {
          this.taskQueue.remove(task.taskId);
        });
      }
    }
    setTimeout(() => this.loop(), 0);
  }
}

export class LocalWaker implements Waker {
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
    return this.timers.size === 0;
  }
}

const VISIBILITY_WINDOW = 300000;

export class LocalTaskQueue {
  private queue: (Task & { taskId: number; visibleFrom: number })[] = [];
  private nextTaskId: number = 0;

  add(task: Task) {
    this.queue.push({
      taskId: this.nextTaskId++,
      visibleFrom: Date.now(),
      ...task,
    });
  }

  process() {
    const now = Date.now();
    const task = this.queue.find((task) => task.visibleFrom <= now);

    if (!task) return undefined;

    task.visibleFrom = now + VISIBILITY_WINDOW;

    return task;
  }

  remove(taskId: number) {
    this.queue = this.queue.filter((task) => task.taskId !== taskId);
  }

  makeVisible(taskId: number) {
    const task = this.queue.find((task) => task.taskId === taskId);
    if (task) {
      task.visibleFrom = Date.now();
    }
  }

  private get visibleQueue() {
    return this.queue.filter((t) => t.visibleFrom < Date.now());
  }

  get isEmpty() {
    return this.visibleQueue.length === 0;
  }
}

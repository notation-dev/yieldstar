import type { WorkflowEvent } from "@yieldstar/core";

const VISIBILITY_WINDOW = 300000;

type Task = {
  event: WorkflowEvent;
  taskId: number;
  visibleFrom: number;
};

export class MemoryTaskQueue {
  private queue: Task[] = [];
  private nextTaskId: number = 0;

  add(event: WorkflowEvent) {
    this.queue.push({
      taskId: this.nextTaskId++,
      visibleFrom: Date.now(),
      event,
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

  clear() {
    this.queue = [];
  }

  private get visibleQueue() {
    return this.queue.filter((t) => t.visibleFrom < Date.now());
  }

  get isEmpty() {
    return this.visibleQueue.length === 0;
  }
}

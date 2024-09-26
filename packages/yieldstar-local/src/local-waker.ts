import type { Task, Waker, WakeUpHandler } from "yieldstar";

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

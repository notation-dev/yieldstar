import type { Scheduler } from "yieldstar";
import { SqliteTaskQueue } from "./sqlite-task-queue";
import { SqliteTimers } from "./sqlite-timers";

export class SqliteScheduler implements Scheduler {
  private taskQueue: SqliteTaskQueue;
  private timers: SqliteTimers;

  constructor(params: { taskQueue: SqliteTaskQueue; timers: SqliteTimers }) {
    this.taskQueue = params.taskQueue;
    this.timers = params.timers;
  }

  async requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn?: number;
  }) {
    const { resumeIn, ...task } = params;
    if (!resumeIn) {
      await this.taskQueue.add(task);
      return;
    }
    await this.timers.startTimer({
      duration: resumeIn,
      workflowId: params.workflowId,
      executionId: params.executionId,
    });
  }
}

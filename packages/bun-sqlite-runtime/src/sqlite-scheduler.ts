import type { SchedulerClient } from "@yieldstar/core";
import { SqliteTaskQueueClient } from "./sqlite-task-queue";
import { SqliteTimersClient } from "./sqlite-timers";

export class SqliteSchedulerClient implements SchedulerClient {
  private taskQueue: SqliteTaskQueueClient;
  private timersClient: SqliteTimersClient;

  constructor(params: {
    taskQueueClient: SqliteTaskQueueClient;
    timersClient: SqliteTimersClient;
  }) {
    this.taskQueue = params.taskQueueClient;
    this.timersClient = params.timersClient;
  }

  async requestWakeUp(params: {
    workflowId: string;
    executionId: string;
    resumeIn?: number;
  }) {
    const { resumeIn, ...task } = params;
    if (resumeIn) {
      this.timersClient.createTimer({
        delay: resumeIn,
        workflowId: params.workflowId,
        executionId: params.executionId,
      });
    } else {
      this.taskQueue.add(task);
    }
  }
}

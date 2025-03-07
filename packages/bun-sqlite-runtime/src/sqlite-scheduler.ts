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

  async requestWakeUp(
    event: { workflowId: string; executionId: string; params?: any },
    resumeIn?: number
  ) {
    if (resumeIn) {
      this.timersClient.createTimer(event, resumeIn);
    } else {
      this.taskQueue.add(event);
    }
  }
}

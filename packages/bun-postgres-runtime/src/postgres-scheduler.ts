import type { SchedulerClient, WorkflowEvent } from "@yieldstar/core";
import { PostgresTaskQueueClient } from "./postgres-task-queue";
import { PostgresTimersClient } from "./postgres-timers";

export class PostgresSchedulerClient implements SchedulerClient {
  private taskQueue: PostgresTaskQueueClient;
  private timersClient: PostgresTimersClient;

  constructor(params: {
    taskQueueClient: PostgresTaskQueueClient;
    timersClient: PostgresTimersClient;
  }) {
    this.taskQueue = params.taskQueueClient;
    this.timersClient = params.timersClient;
  }

  async requestWakeUp(event: WorkflowEvent, resumeIn?: number) {
    if (resumeIn) {
      await this.timersClient.createTimer(event, resumeIn);
    } else {
      await this.taskQueue.add(event);
    }
  }
}

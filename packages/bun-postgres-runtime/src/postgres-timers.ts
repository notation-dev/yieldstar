import type { SQL } from "bun";
import { TimersDao } from "./dao/timers-dao";
import { PostgresTaskQueue } from "./postgres-task-queue";
import type { WorkflowEvent } from "@yieldstar/core";

export class PostgresTimers {
  private timersDao: TimersDao;
  private taskQueue: PostgresTaskQueue;

  constructor(params: { sql: SQL; taskQueue: PostgresTaskQueue }) {
    this.timersDao = new TimersDao(params.sql);
    this.taskQueue = params.taskQueue;
  }

  async processTimers() {
    const timers = await this.timersDao.getExpiredTimers();
    for (const timer of timers) {
      await this.timersDao.deleteTimerById(timer.id);
      await this.taskQueue.add({
        workflowId: timer.workflow_id,
        executionId: timer.execution_id,
        params: timer.params ? JSON.parse(timer.params) : undefined,
        context: timer.context ? new Map(JSON.parse(timer.context)) : new Map(),
      });
    }
  }
}

export class PostgresTimersClient {
  private timersDao: TimersDao;

  constructor(sql: SQL) {
    this.timersDao = new TimersDao(sql);
  }

  async createTimer(event: WorkflowEvent, delay: number) {
    await this.timersDao.insertTimer(event, delay);
  }
}

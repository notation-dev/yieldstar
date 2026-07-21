import { TimersDao } from "./dao/timers-dao";
import { SqliteTaskQueue } from "./sqlite-task-queue";
import { FreezableMap } from "@yieldstar/core";
import type { WorkflowEvent } from "@yieldstar/core";
import type { SqliteDriver } from "./sqlite-driver";

export class SqliteTimers {
  private timersDao: TimersDao;
  private taskQueue: SqliteTaskQueue;

  constructor(params: { db: SqliteDriver; taskQueue: SqliteTaskQueue }) {
    this.timersDao = new TimersDao(params.db);
    this.taskQueue = params.taskQueue;
  }

  processTimers() {
    const timers = this.timersDao.getExpiredTimers();
    for (const timer of timers) {
      this.timersDao.deleteTimerById(timer.id);
      this.taskQueue.add({
        workflowId: timer.workflow_id,
        executionId: timer.execution_id,
        params: timer.params ? JSON.parse(timer.params) : undefined,
        context: timer.context ? new Map(JSON.parse(timer.context)) : new Map(),
      });
    }
  }
}

export class SqliteTimersClient {
  private timersDao: TimersDao;

  constructor(db: SqliteDriver) {
    this.timersDao = new TimersDao(db);
  }

  createTimer(event: WorkflowEvent, delay: number) {
    this.timersDao.insertTimer(event, delay);
  }
}

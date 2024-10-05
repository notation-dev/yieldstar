import { Database } from "bun:sqlite";
import { TimersDao } from "./dao/timers-dao";
import { SqliteTaskQueue } from "./sqlite-task-queue";

export class SqliteTimers {
  private timersDao: TimersDao;
  private taskQueue: SqliteTaskQueue;

  constructor(params: { db: Database; taskQueue: SqliteTaskQueue }) {
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
      });
    }
  }
}

export class SqliteTimersClient {
  private timersDao: TimersDao;

  constructor(db: Database) {
    this.timersDao = new TimersDao(db);
  }

  createTimer(params: {
    delay: number;
    workflowId: string;
    executionId: string;
  }) {
    this.timersDao.insertTimer(
      params.delay,
      params.workflowId,
      params.executionId
    );
  }
}

import { Database } from "bun:sqlite";
import { TimersDao } from "./dao/timers-dao";
import { SqliteTaskQueue } from "./sqlite-task-queue";

export class SqliteTimers {
  private timersDao: TimersDao;
  private taskQueue: SqliteTaskQueue;

  constructor(params: { db: Database; taskQueue: SqliteTaskQueue }) {
    this.timersDao = new TimersDao(params.db);
    this.taskQueue = params.taskQueue;
    this.restoreTimers(); // Restore timers on startup
  }

  private async restoreTimers() {
    const timers = this.timersDao.getAllTimers();
    const now = Date.now();

    for (const timer of timers) {
      const remainingTime = timer.duration - (now - timer.created_at);
      if (remainingTime > 0) {
        setTimeout(async () => {
          this.taskQueue.add({
            workflowId: timer.workflow_id,
            executionId: timer.execution_id,
          });
          this.timersDao.deleteTimerById(timer.id);
        }, remainingTime);
      } else {
        this.taskQueue.add({
          workflowId: timer.workflow_id,
          executionId: timer.execution_id,
        });
        this.timersDao.deleteTimerById(timer.id);
      }
    }
  }

  async startTimer(params: {
    duration: number;
    workflowId: string;
    executionId: string;
  }) {
    const createdAt = Date.now();

    this.timersDao.insertTimer(
      params.duration,
      params.workflowId,
      params.executionId,
      createdAt
    );

    setTimeout(async () => {
      this.taskQueue.add({
        workflowId: params.workflowId,
        executionId: params.executionId,
      });
      this.timersDao.deleteTimerByWorkflowAndExecution(
        params.workflowId,
        params.executionId
      );
    }, params.duration);
  }
}

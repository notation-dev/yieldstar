import { Database } from "bun:sqlite";
import type { ExecutionEvent } from "@yieldstar/core";
import { TaskQueueDao } from "./dao/task-queue-dao";

const VISIBILITY_WINDOW = 300000;

export class SqliteTaskQueue {
  private taskQueueDao: TaskQueueDao;

  constructor(db: Database) {
    this.taskQueueDao = new TaskQueueDao(db);
    this.taskQueueDao.setupDb();
  }

  add(task: ExecutionEvent) {
    this.taskQueueDao.insertTask(task);
  }

  process() {
    const row = this.taskQueueDao.getNextTask();

    if (!row) return undefined;

    const visibilityTimeout =
      Math.floor(Date.now() / 1000) + VISIBILITY_WINDOW / 1000;
    this.taskQueueDao.updateTaskVisibility(row.task_id, visibilityTimeout);

    return {
      taskId: row.task_id,
      workflowId: row.workflow_id,
      executionId: row.execution_id,
      params: row.params ? JSON.parse(row.params) : undefined,
    };
  }

  remove(taskId: number) {
    this.taskQueueDao.deleteTaskById(taskId);
  }

  makeVisible(taskId: number) {
    this.taskQueueDao.updateTaskVisibility(taskId, 0);
  }

  get isEmpty(): boolean {
    return this.taskQueueDao.getTaskCount() === 0;
  }
}

export class SqliteTaskQueueClient {
  private taskQueueDao: TaskQueueDao;

  constructor(db: Database) {
    this.taskQueueDao = new TaskQueueDao(db);
  }

  add(task: ExecutionEvent) {
    this.taskQueueDao.insertTask(task);
  }
}

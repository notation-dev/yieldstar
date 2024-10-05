import { Database } from "bun:sqlite";
import type { Task } from "yieldstar";
import { TaskQueueDao } from "./dao/task-queue-dao";

const VISIBILITY_WINDOW = 300000;

export class SqliteTaskQueue {
  private taskQueueDao: TaskQueueDao;

  constructor(db: Database) {
    this.taskQueueDao = new TaskQueueDao(db);
    this.taskQueueDao.setupDb();
  }

  add(task: Task) {
    this.taskQueueDao.insertTask(task);
  }

  process() {
    const row = this.taskQueueDao.getNextTask();

    if (!row) return undefined;

    const now = Date.now();
    const visibilityTimeout = now + VISIBILITY_WINDOW;

    this.taskQueueDao.updateTaskVisibility(row.task_id, visibilityTimeout);

    return {
      taskId: row.task_id,
      workflowId: row.workflow_id,
      executionId: row.execution_id,
      visibilityTimeout,
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
  add(task: Task) {
    this.taskQueueDao.insertTask(task);
  }
}

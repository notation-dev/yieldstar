import { Database } from "bun:sqlite";
import type { Task } from "yieldstar";
import { TaskQueueDao } from "./dao/task-queue-dao";

export class SqliteTaskQueue {
  private taskQueueDao: TaskQueueDao;

  constructor(db: Database) {
    this.taskQueueDao = new TaskQueueDao(db);
    this.taskQueueDao.setupDb();
  }

  add(task: Task) {
    this.taskQueueDao.insertTask(task);
  }

  remove() {
    const row = this.taskQueueDao.getNextTask();

    if (!row) return undefined;

    this.taskQueueDao.deleteTaskById(row.id);

    return {
      workflowId: row.workflow_id,
      executionId: row.execution_id,
    };
  }

  get isEmpty(): boolean {
    return this.taskQueueDao.getTaskCount() === 0;
  }
}

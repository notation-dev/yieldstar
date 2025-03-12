import { Database } from "bun:sqlite";
import type { WorkflowEvent } from "@yieldstar/core";
import { TaskQueueDao } from "./dao/task-queue-dao";

const VISIBILITY_WINDOW = 300000;

export class SqliteTaskQueue {
  private taskQueueDao: TaskQueueDao;

  constructor(db: Database) {
    this.taskQueueDao = new TaskQueueDao(db);
    this.taskQueueDao.setupDb();
  }

  add(event: WorkflowEvent) {
    this.taskQueueDao.insertTask(event);
  }

  process() {
    const row = this.taskQueueDao.getNextTask();

    if (!row) return undefined;

    const now = Date.now();
    const visibilityTimeout = now + VISIBILITY_WINDOW;

    this.taskQueueDao.updateTaskVisibility(row.task_id, visibilityTimeout);

    return {
      taskId: row.task_id,
      visibilityTimeout,
      event: {
        workflowId: row.workflow_id,
        executionId: row.execution_id,
        params: row.params ? JSON.parse(row.params) : undefined,
        context: row.context ? new Map(JSON.parse(row.context)) : new Map(),
      },
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

  add(event: WorkflowEvent) {
    this.taskQueueDao.insertTask(event);
  }
}

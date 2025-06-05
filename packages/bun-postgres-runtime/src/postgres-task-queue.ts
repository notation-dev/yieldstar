import type { WorkflowEvent } from "@yieldstar/core";
import type { SQL } from "bun";
import { TaskQueueDao } from "./dao/task-queue-dao";

const VISIBILITY_WINDOW = 300000;

export class PostgresTaskQueue {
  private taskQueueDao: TaskQueueDao;

  constructor(sql: SQL) {
    this.taskQueueDao = new TaskQueueDao(sql);
  }

  async add(event: WorkflowEvent) {
    await this.taskQueueDao.insertTask(event);
  }

  async process() {
    const row = await this.taskQueueDao.getNextTask();

    if (!row) return undefined;

    const now = Date.now();
    const visibilityTimeout = now + VISIBILITY_WINDOW;

    await this.taskQueueDao.updateTaskVisibility(row.task_id, visibilityTimeout);

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

  async remove(taskId: number) {
    await this.taskQueueDao.deleteTaskById(taskId);
  }

  async makeVisible(taskId: number) {
    await this.taskQueueDao.updateTaskVisibility(taskId, 0);
  }

  async isEmpty(): Promise<boolean> {
    return (await this.taskQueueDao.getTaskCount()) === 0;
  }
}

export class PostgresTaskQueueClient {
  private taskQueueDao: TaskQueueDao;

  constructor(sql: SQL) {
    this.taskQueueDao = new TaskQueueDao(sql);
  }

  async add(event: WorkflowEvent) {
    await this.taskQueueDao.insertTask(event);
  }
}

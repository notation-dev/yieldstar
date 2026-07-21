import type { WorkflowEvent } from "@yieldstar/core";
import type { SqliteDriver } from "../sqlite-driver";

class TaskRow {
  task_id!: number;
  workflow_id!: string;
  execution_id!: string;
  params?: string;
  context?: string;
}

class CountRow {
  count!: number;
}

export class TaskQueueDao {
  private db: SqliteDriver;

  constructor(db: SqliteDriver) {
    this.db = db;
  }

  setupDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS task_queue (
        task_id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        params TEXT,
        context TEXT,
        visible_from INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  insertTask(event: WorkflowEvent) {
    const query = this.db.query(
      `INSERT INTO task_queue (workflow_id, execution_id, params, context)
      VALUES ($workflowId, $executionId, $params, $context)`
    );

    query.run({
      $workflowId: event.workflowId,
      $executionId: event.executionId,
      $params: event.params ? JSON.stringify(event.params) : null,
      $context: event.context
        ? JSON.stringify(Array.from(event.context.entries()))
        : null,
    });
  }

  getNextTask() {
    const query = this.db.query<TaskRow>(
      `SELECT * FROM task_queue WHERE visible_from < strftime('%s', 'now') ORDER BY task_id LIMIT 1`
    );
    return query.get();
  }

  updateTaskVisibility(taskId: number, visibleFrom: number) {
    const query = this.db.query(
      "UPDATE task_queue SET visible_from = $visibleFrom WHERE task_id = $taskId"
    );
    query.run({ $taskId: taskId, $visibleFrom: visibleFrom });
  }

  deleteTaskById(id: number) {
    const query = this.db.query(
      `DELETE FROM task_queue WHERE task_id = $taskId`
    );
    query.run({ $taskId: id });
  }

  getTaskCount() {
    const query = this.db.query<CountRow>(
      `SELECT COUNT(*) as count FROM task_queue WHERE visible_from < strftime('%s', 'now')`
    );
    return query.get()!.count;
  }
}

import { Database } from "bun:sqlite";
import type { WorkflowEvent } from "@yieldstar/core";

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
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  setupDb() {
    this.db.exec(`
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
    const query = this.db.prepare(
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
    const query = this.db.prepare(
      `SELECT * FROM task_queue WHERE visible_from < strftime('%s', 'now') ORDER BY task_id LIMIT 1`
    );
    return query.get() as TaskRow | undefined;
  }

  updateTaskVisibility(taskId: number, visibleFrom: number) {
    const query = this.db.prepare(
      "UPDATE task_queue SET visible_from = $visibleFrom WHERE task_id = $taskId"
    );
    query.run({ $taskId: taskId, $visibleFrom: visibleFrom });
  }

  deleteTaskById(id: number) {
    const query = this.db.prepare(
      `DELETE FROM task_queue WHERE task_id = $taskId`
    );
    query.run({ $taskId: id });
  }

  getTaskCount() {
    const query = this.db.prepare(
      `SELECT COUNT(*) as count FROM task_queue WHERE visible_from < strftime('%s', 'now')`
    );
    const result = query.get() as CountRow;
    return result.count;
  }
}

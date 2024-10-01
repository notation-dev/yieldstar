import { Database } from "bun:sqlite";
import type { Task } from "yieldstar";

class TaskRow {
  task_id!: number;
  workflow_id!: string;
  execution_id!: string;
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS task_queue (
        task_id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        visible_from INTEGER DEFAULT 0
      );
    `);
  }

  insertTask(task: Task) {
    const query = this.db.query(
      `INSERT INTO task_queue (workflow_id, execution_id) 
      VALUES ($workflowId, $executionId)`
    );

    query.run({
      $workflowId: task.workflowId,
      $executionId: task.executionId,
    });
  }

  getNextTask() {
    const query = this.db
      .query(
        `SELECT * FROM task_queue WHERE visible_from < strftime('%s', 'now') ORDER BY task_id LIMIT 1`
      )
      .as(TaskRow);

    return query.get();
  }

  updateTaskVisibility(taskId: number, visibleFrom: number) {
    this.db
      .query(
        "UPDATE task_queue SET visible_from = $visibleFrom WHERE task_id = $taskId"
      )
      .run({ $taskId: taskId, $visibleFrom: visibleFrom / 1000 });
  }

  deleteTaskById(id: number) {
    const query = this.db.query(
      `DELETE FROM task_queue WHERE task_id = $taskId`
    );
    query.run({ $taskId: id });
  }

  getTaskCount() {
    const query = this.db
      .query(
        `SELECT COUNT(*) as count FROM task_queue WHERE visible_from < strftime('%s', 'now')`
      )
      .as(CountRow);

    const count = query.get()!;
    return count.count;
  }
}

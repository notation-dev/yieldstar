import { Database } from "bun:sqlite";
import type { Task } from "yieldstar";

class TaskRow {
  id!: number;
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL
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
      .query(`SELECT * FROM task_queue ORDER BY id LIMIT 1`)
      .as(TaskRow);

    return query.get();
  }

  deleteTaskById(id: number) {
    const query = this.db.query(`DELETE FROM task_queue WHERE id = $id`);
    query.run({ $id: id });
  }

  getTaskCount() {
    const query = this.db
      .query(`SELECT COUNT(*) as count FROM task_queue`)
      .as(CountRow);

    const count = query.get()!;
    return count.count;
  }
}

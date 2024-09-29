import { Database } from "bun:sqlite";
import type { Task } from "yieldstar";

class DbTask {
  id!: number;
  workflow_id!: string;
  execution_id!: string;
}

class DbCount {
  count!: number;
}

export class SqliteTaskQueue {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.setupDb();
  }

  private setupDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL
      );
    `);
  }

  add(task: Task) {
    const query = this.db.query(`
      INSERT INTO task_queue (workflow_id, execution_id) 
      VALUES ($workflowId, $executionId)
    `);

    query.run({
      $workflowId: task.workflowId,
      $executionId: task.executionId,
    });
  }

  remove() {
    const query = this.db
      .query(`SELECT * FROM task_queue ORDER BY id LIMIT 1`)
      .as(DbTask);

    const row = query.get();

    if (!row) return undefined;

    this.db.query(`DELETE FROM task_queue WHERE id = $id`).run({ $id: row.id });

    return {
      workflowId: row.workflow_id,
      executionId: row.execution_id,
    };
  }

  get isEmpty(): boolean {
    const query = this.db
      .query(`SELECT COUNT(*) as count FROM task_queue`)
      .as(DbCount);

    const count = query.get()!;
    return count.count === 0;
  }
}

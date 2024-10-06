import { Database } from "bun:sqlite";

class TimerRow {
  id!: string;
  delay!: number;
  workflow_id!: string;
  execution_id!: string;
  created_at!: number;
}

class CountRow {
  count!: number;
}

export class TimersDao {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.setupDb();
  }

  private setupDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delay INTEGER NOT NULL,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  getExpiredTimers(): TimerRow[] {
    const query = this.db
      .query(
        `SELECT id, delay, workflow_id, execution_id, created_at 
        FROM scheduled_tasks 
        WHERE (created_at + delay) < $currentTime`
      )
      .as(TimerRow);

    return query.all({ $currentTime: Date.now() });
  }

  getTaskCount() {
    const query = this.db
      .query(
        `SELECT COUNT(*) as count 
        FROM scheduled_tasks 
        WHERE (created_at + delay) < $currentTime`
      )
      .as(CountRow);

    const count = query.get({ $currentTime: Date.now() })!;
    return count.count;
  }

  insertTimer(delay: number, workflowId: string, executionId: string) {
    const createdAt = Date.now();

    const query = this.db.query(
      `INSERT INTO scheduled_tasks (delay, workflow_id, execution_id, created_at) 
        VALUES ($delay, $workflowId, $executionId, $createdAt)`
    );
    query.run({
      $delay: delay,
      $workflowId: workflowId,
      $executionId: executionId,
      $createdAt: createdAt,
    });
  }

  deleteTimerById(id: string) {
    const query = this.db.query(`DELETE FROM scheduled_tasks WHERE id = $id`);
    query.run({ $id: id });
  }
}

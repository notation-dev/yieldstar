import type { ExecutionEvent } from "@yieldstar/core";
import { Database } from "bun:sqlite";

class TimerRow {
  id!: string;
  delay!: number;
  workflow_id!: string;
  execution_id!: string;
  created_at!: number;
  params?: string;
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
        created_at INTEGER NOT NULL,
        params TEXT
      );
    `);
  }

  getExpiredTimers(): TimerRow[] {
    const query = this.db
      .query(
        `SELECT id, delay, workflow_id, execution_id, created_at, params 
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

  insertTimer(event: ExecutionEvent, delay: number) {
    const query = this.db.query(
      `INSERT INTO scheduled_tasks (delay, workflow_id, execution_id, created_at, params) 
      VALUES ($delay, $workflowId, $executionId, $createdAt, $params)`
    );

    query.run({
      $delay: delay,
      $workflowId: event.workflowId,
      $executionId: event.executionId,
      $createdAt: Date.now(),
      $params: event.params ? JSON.stringify(event.params) : null,
    });
  }

  deleteTimerById(id: string) {
    const query = this.db.query(`DELETE FROM scheduled_tasks WHERE id = $id`);
    query.run({ $id: id });
  }
}

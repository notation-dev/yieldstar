import type { WorkflowEvent } from "@yieldstar/core";
import type { SqliteDriver } from "../sqlite-driver";

class TimerRow {
  id!: string;
  delay!: number;
  workflow_id!: string;
  execution_id!: string;
  created_at!: number;
  params?: string;
  context?: string;
}

class CountRow {
  count!: number;
}

export class TimersDao {
  private db: SqliteDriver;

  constructor(db: SqliteDriver) {
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
        params TEXT,
        context TEXT
      );
    `);
  }

  getExpiredTimers(): TimerRow[] {
    const query = this.db.query<TimerRow>(
      `SELECT id, delay, workflow_id, execution_id, created_at, params, context
       FROM scheduled_tasks
       WHERE (created_at + delay) < $currentTime`
    );

    return query.all({ $currentTime: Date.now() });
  }

  getTaskCount() {
    const query = this.db.query<CountRow>(
      `SELECT COUNT(*) as count
       FROM scheduled_tasks
       WHERE (created_at + delay) < $currentTime`
    );

    const count = query.get({ $currentTime: Date.now() })!;
    return count.count;
  }

  insertTimer(event: WorkflowEvent, delay: number) {
    const query = this.db.query(
      `INSERT INTO scheduled_tasks (delay, workflow_id, execution_id, created_at, params, context) 
      VALUES ($delay, $workflowId, $executionId, $createdAt, $params, $context)`
    );

    query.run({
      $delay: delay,
      $workflowId: event.workflowId,
      $executionId: event.executionId,
      $createdAt: Date.now(),
      $params: event.params ? JSON.stringify(event.params) : null,
      $context: JSON.stringify(Array.from(event.context.entries())),
    });
  }

  deleteTimerById(id: string) {
    const query = this.db.query(`DELETE FROM scheduled_tasks WHERE id = $id`);
    query.run({ $id: id });
  }
}

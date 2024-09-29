import { Database } from "bun:sqlite";

class TimerRow {
  id!: string;
  duration!: number;
  workflow_id!: string;
  execution_id!: string;
  created_at!: number;
}

export class TimersDao {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.setupDb();
  }

  private setupDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        duration INTEGER NOT NULL,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  getAllTimers(): TimerRow[] {
    const query = this.db
      .query(
        `SELECT id, duration, workflow_id, execution_id, created_at FROM timers`
      )
      .as(TimerRow);

    return query.all();
  }

  insertTimer(
    duration: number,
    workflowId: string,
    executionId: string,
    createdAt: number
  ) {
    const query = this.db.query(
      `INSERT INTO timers (duration, workflow_id, execution_id, created_at) 
        VALUES ($duration, $workflowId, $executionId, $createdAt)`
    );
    query.run({
      $duration: duration,
      $workflowId: workflowId,
      $executionId: executionId,
      $createdAt: createdAt,
    });
  }

  deleteTimerById(id: string) {
    const query = this.db.query(`DELETE FROM timers WHERE id = $id`);
    query.run({ $id: id });
  }

  deleteTimerByWorkflowAndExecution(workflowId: string, executionId: string) {
    const query = this.db.query(
      `DELETE FROM timers WHERE workflow_id = $workflowId AND execution_id = $executionId`
    );
    query.run({ $workflowId: workflowId, $executionId: executionId });
  }
}

import { Database } from "bun:sqlite";
import { SqliteTaskQueue } from "./sqlite-task-queue";

export class SqliteTimers {
  private db: Database;
  private taskQueue: SqliteTaskQueue;

  constructor(params: { db: Database; taskQueue: SqliteTaskQueue }) {
    this.db = params.db;
    this.taskQueue = params.taskQueue;
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

  async startTimer(params: {
    duration: number;
    workflowId: string;
    executionId: string;
  }) {
    const creatTimerQuery = this.db.query(`
      INSERT INTO timers (duration, workflow_id, execution_id, created_at) 
      VALUES ($duration, $workflowId, $executionId, $createdAt)
    `);

    const deleteTimerQuery = this.db.query(
      `DELETE FROM timers WHERE workflow_id = $workflowId AND execution_id = $executionId`
    );

    const createdAt = Date.now();

    creatTimerQuery.run({
      $duration: params.duration,
      $workflowId: params.workflowId,
      $executionId: params.executionId,
      $createdAt: createdAt,
    });

    setTimeout(async () => {
      await this.taskQueue.add({
        workflowId: params.workflowId,
        executionId: params.executionId,
      });
      deleteTimerQuery.run({
        $workflowId: params.workflowId,
        $executionId: params.executionId,
      });
    }, params.duration);
  }

  get isEmpty() {
    const countQuery = this.db.query(`SELECT COUNT(*) as count FROM timers`);
    return countQuery.get() === 0;
  }
}

import type { SQL } from "bun";
import type { WorkflowEvent } from "@yieldstar/core";

interface TimerRow {
  id: number;
  delay: number;
  workflow_id: string;
  execution_id: string;
  created_at: number;
  params?: string;
  context?: string;
}

interface CountRow { count: number }

export class TimersDao {
  private ready: Promise<void>;
  constructor(private sql: SQL) {
    this.ready = this.setupDb();
  }

  private async setupDb() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        delay INTEGER NOT NULL,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        params TEXT,
        context TEXT
      )
    `;
  }

  async getExpiredTimers(): Promise<TimerRow[]> {
    await this.ready;
    const now = Date.now();
    return this.sql`
      SELECT id, delay, workflow_id, execution_id, created_at, params, context
      FROM scheduled_tasks
      WHERE (created_at + delay) < ${now}
    ` as any as TimerRow[];
  }

  async getTaskCount() {
    await this.ready;
    const rows = (await this.sql`
      SELECT COUNT(*)::int as count FROM scheduled_tasks
      WHERE (created_at + delay) < ${Date.now()}
    `) as CountRow[];
    return Number(rows[0]?.count ?? 0);
  }

  async insertTimer(event: WorkflowEvent, delay: number) {
    await this.ready;
    await this.sql`
      INSERT INTO scheduled_tasks (delay, workflow_id, execution_id, created_at, params, context)
      VALUES (${delay}, ${event.workflowId}, ${event.executionId}, ${Date.now()}, ${event.params ? JSON.stringify(event.params) : null}, ${JSON.stringify(Array.from(event.context.entries()))})
    `;
  }

  async deleteTimerById(id: number) {
    await this.ready;
    await this.sql`DELETE FROM scheduled_tasks WHERE id = ${id}`;
  }
}

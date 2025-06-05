import type { SQL } from "bun";
import type { WorkflowEvent } from "@yieldstar/core";

interface TaskRow {
  task_id: number;
  workflow_id: string;
  execution_id: string;
  params?: string;
  context?: string;
  visible_from: number;
}

interface CountRow { count: number }

export class TaskQueueDao {
  private ready: Promise<void>;
  constructor(private sql: SQL) {
    this.ready = this.setupDb();
  }

  private async setupDb() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS task_queue (
        task_id SERIAL PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        params TEXT,
        context TEXT,
        visible_from BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
      )
    `;
  }

  async insertTask(event: WorkflowEvent) {
    await this.ready;
    await this.sql`
      INSERT INTO task_queue (workflow_id, execution_id, params, context, visible_from)
      VALUES (${event.workflowId}, ${event.executionId}, ${event.params ? JSON.stringify(event.params) : null}, ${event.context ? JSON.stringify(Array.from(event.context.entries())) : null}, ${Date.now()})
    `;
  }

  async getNextTask() {
    await this.ready;
    const now = Date.now();
    const rows = await this.sql`
      SELECT * FROM task_queue WHERE visible_from <= ${now} ORDER BY task_id LIMIT 1
    ` as TaskRow[];
    return rows[0];
  }

  async updateTaskVisibility(taskId: number, visibleFrom: number) {
    await this.ready;
    await this.sql`
      UPDATE task_queue SET visible_from = ${visibleFrom} WHERE task_id = ${taskId}
    `;
  }

  async deleteTaskById(id: number) {
    await this.ready;
    await this.sql`DELETE FROM task_queue WHERE task_id = ${id}`;
  }

  async getTaskCount() {
    await this.ready;
    const rows = await this.sql`SELECT COUNT(*)::int as count FROM task_queue WHERE visible_from <= ${Date.now()}` as CountRow[];
    return Number(rows[0]?.count ?? 0);
  }
}

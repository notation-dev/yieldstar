import type { SQL } from "bun";

interface StepResponseRow {
  execution_id: string;
  step_key: string;
  step_attempt: number;
  step_done: boolean;
  step_response: string;
}

export class StepResponsesDao {
  private ready: Promise<void>;
  constructor(private sql: SQL) {
    this.ready = this.setupDb();
  }

  private async setupDb() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS step_responses (
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        step_attempt INTEGER NOT NULL,
        step_done BOOLEAN NOT NULL,
        step_response JSONB,
        PRIMARY KEY (execution_id, step_key, step_attempt)
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_execution_step_attempt
      ON step_responses(execution_id, step_key, step_attempt DESC)
    `;
  }

  async getAllSteps() {
    await this.ready;
    return this.sql`SELECT * FROM step_responses`;
  }

  async deleteAll() {
    await this.ready;
    await this.sql`DELETE FROM step_responses`;
  }

  async getLatestStepResponse(executionId: string, stepKey: string) {
    await this.ready;
    const rows = await this.sql`
      SELECT * FROM step_responses
      WHERE execution_id = ${executionId}
      AND step_key = ${stepKey}
      ORDER BY step_attempt DESC LIMIT 1
    ` as StepResponseRow[];

    return rows[0];
  }

  async insertStepResponse(
    executionId: string,
    stepKey: string,
    stepAttempt: number,
    stepDone: boolean,
    stepResponseJson: string
  ) {
    await this.ready;
    await this.sql`
      INSERT INTO step_responses (execution_id, step_key, step_attempt, step_done, step_response)
      VALUES (${executionId}, ${stepKey}, ${stepAttempt}, ${stepDone}, ${stepResponseJson})
    `;
  }
}

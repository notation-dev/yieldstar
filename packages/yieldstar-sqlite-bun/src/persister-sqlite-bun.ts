import type { StepPersister } from "yieldstar";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "path";

type DbResult = {
  execution_id: string;
  step_key: string;
  step_attempt: number;
  step_done: 0 | 1;
  step_response: string;
};

export class SqlitePersister implements StepPersister {
  db: Database;

  constructor(params: { db: Database }) {
    this.db = params.db;
  }

  static async createDb(path: string) {
    const dirPath = dirname(path);
    await mkdir(dirPath, { recursive: true });
    const db = new Database(path, { create: true });
    SqlitePersister.setupDb(db);
    return db;
  }

  static setupDb(db: Database) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.run(`
    CREATE TABLE IF NOT EXISTS step_responses (
      execution_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_attempt INTEGER NOT NULL,
      step_done BOOL NOT NULL,
      step_response JSONB,
      PRIMARY KEY (execution_id, step_key, step_attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_execution_step_attempt 
    ON step_responses(execution_id, step_key, step_attempt DESC);
    `);
    return db;
  }

  async getAllSteps() {
    const query = this.db.query(`SELECT * FROM step_responses`);
    return query.all();
  }

  async deleteAll() {
    const query = this.db.query(`DELETE FROM step_responses`);
    return query.run();
  }

  async readStep(params: { executionId: string; stepKey: string }) {
    const query = this.db.query(
      `SELECT * FROM step_responses 
        WHERE execution_id = $executionId 
        AND step_key = $stepKey
        ORDER BY step_attempt DESC LIMIT 1`
    );

    const result = query.get({
      $executionId: params.executionId,
      $stepKey: params.stepKey,
    }) as DbResult;

    if (!result?.step_response) {
      return null;
    }

    return {
      stepResponseJson: result.step_response,
      meta: {
        attempt: result.step_attempt,
        done: Boolean(result.step_done),
      },
    };
  }

  async writeStep(params: {
    executionId: string;
    stepKey: string;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }) {
    const query = this.db.query(`
      INSERT INTO step_responses (execution_id, step_key, step_attempt, step_done, step_response) 
      VALUES ($executionId, $stepKey, $stepAttempt, $stepDone, $stepResponse)`);

    query.run({
      $executionId: params.executionId,
      $stepKey: params.stepKey,
      $stepAttempt: params.stepAttempt,
      $stepDone: params.stepDone,
      $stepResponse: params.stepResponseJson,
    });
  }
}

import { Database } from "bun:sqlite";
import { WorkerConnector } from "yieldstar";
import { mkdir } from "node:fs/promises";
import { dirname } from "path";

type DbResult = {
  execution_id: string;
  step_index: number;
  step_attempt: number;
  step_done: 0 | 1;
  step_response: string;
};

export class SqliteConnector extends WorkerConnector {
  db: Database;

  constructor(params: { db: Database }) {
    super();
    this.db = params.db;
  }

  static async createDb(path: string) {
    const dirPath = dirname(path);
    await mkdir(dirPath, { recursive: true });
    const db = new Database(path, { create: true });
    SqliteConnector.setupDb(db);
    return db;
  }

  static setupDb(db: Database) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.run(`
    CREATE TABLE IF NOT EXISTS step_responses (
      execution_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_attempt INTEGER NOT NULL,
      step_done BOOL NOT NULL,
      step_response JSONB,
      PRIMARY KEY (execution_id, step_index, step_attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_execution_step_attempt 
    ON step_responses(execution_id, step_index, step_attempt DESC);
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

  async onStart() {
    console.log("[INFO]: Workflow start");
  }

  async onEnd() {
    console.log("[INFO]: Workflow end");
  }

  async onBeforeRun(params: { executionId: string; stepIndex: number }) {
    const query = this.db.query(
      `SELECT * FROM step_responses 
        WHERE execution_id = $executionId 
        AND step_index = $stepIndex
        ORDER BY step_attempt DESC LIMIT 1`
    );

    const result = query.get({
      $executionId: params.executionId,
      $stepIndex: params.stepIndex,
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

  async onAfterRun(params: {
    executionId: string;
    stepIndex: number;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }) {
    const query = this.db.query(`
      INSERT INTO step_responses (execution_id, step_index, step_attempt, step_done, step_response) 
      VALUES ($executionId, $stepIndex, $stepAttempt, $stepDone, $stepResponse)`);

    query.run({
      $executionId: params.executionId,
      $stepIndex: params.stepIndex,
      $stepAttempt: params.stepAttempt,
      $stepDone: params.stepDone,
      $stepResponse: params.stepResponseJson,
    });
  }

  async onSchedule(executionId: string, timestamp: number) {
    console.log(`[INFO]: Scheduled for ${timestamp}`);
  }

  async onFailure() {}
  async onAbandon() {}
}

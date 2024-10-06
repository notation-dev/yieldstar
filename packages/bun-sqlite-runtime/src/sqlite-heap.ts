import type { HeapClient } from "@yieldstar/core";
import { Database } from "bun:sqlite";
import { StepResponsesDao } from "./dao/step-response-dao";

export class SqliteHeapClient implements HeapClient {
  private stepResponsesDao: StepResponsesDao;

  constructor(db: Database) {
    this.stepResponsesDao = new StepResponsesDao(db);
  }

  async getAllSteps() {
    return this.stepResponsesDao.getAllSteps();
  }

  async deleteAll() {
    return this.stepResponsesDao.deleteAll();
  }

  async readStep(params: { executionId: string; stepKey: string }) {
    const result = this.stepResponsesDao.getLatestStepResponse(
      params.executionId,
      params.stepKey
    );

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
    this.stepResponsesDao.insertStepResponse(
      params.executionId,
      params.stepKey,
      params.stepAttempt,
      params.stepDone,
      params.stepResponseJson
    );
  }
}

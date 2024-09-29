import type { StepPersister } from "yieldstar";
import { Database } from "bun:sqlite";
import { StepResponsesDao } from "./dao/step-response-dao";

export class SqlitePersister implements StepPersister {
  private stepResponsesDao: StepResponsesDao;

  constructor(params: { db: Database }) {
    this.stepResponsesDao = new StepResponsesDao(params.db);
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

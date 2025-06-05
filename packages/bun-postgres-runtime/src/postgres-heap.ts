import type { HeapClient } from "@yieldstar/core";
import type { SQL } from "bun";
import { StepResponsesDao } from "./dao/step-response-dao";

export class PostgresHeapClient implements HeapClient {
  private stepResponsesDao: StepResponsesDao;

  constructor(sql: SQL) {
    this.stepResponsesDao = new StepResponsesDao(sql);
  }

  async getAllSteps() {
    return this.stepResponsesDao.getAllSteps();
  }

  async deleteAll() {
    await this.stepResponsesDao.deleteAll();
  }

  async readStep(params: { executionId: string; stepKey: string }) {
    const result = await this.stepResponsesDao.getLatestStepResponse(
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
    await this.stepResponsesDao.insertStepResponse(
      params.executionId,
      params.stepKey,
      params.stepAttempt,
      params.stepDone,
      params.stepResponseJson
    );
  }
}

import type { CacheResponse } from "yieldstar";
import { StepPersister } from "yieldstar";

export class MemoryPersister extends StepPersister {
  cache: Record<string, CacheResponse[]> = {};
  getKey(params: { executionId: string; stepKey: string }) {
    return `${params.executionId}:${params.stepKey}`;
  }
  async readStep(params: { executionId: string; stepKey: string }) {
    const attempts = this.cache[this.getKey(params)];
    if (!attempts) return null;
    return attempts[0];
  }
  async writeStep(params: {
    executionId: string;
    stepKey: string;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }) {
    const { stepAttempt, stepDone, stepResponseJson, ...keyParams } = params;
    const key = this.getKey(keyParams);
    const value = {
      stepResponseJson,
      meta: {
        attempt: stepAttempt,
        done: stepDone,
      },
    };
    const attempts = this.cache[key];
    if (!attempts) this.cache[key] = [];
    this.cache[key].unshift(value);
  }
}

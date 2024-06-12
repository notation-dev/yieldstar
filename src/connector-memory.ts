import { WorkerConnector } from "./connector";

export class MemoryConnector extends WorkerConnector {
  cache: Record<string, any[]> = {};
  async onStart() {
    console.log("[INFO]: Workflow start");
  }
  async onEnd() {
    console.log("[INFO]: Workflow end");
  }
  getKey(params: { executionId: string; stepIndex: number }) {
    return `${params.executionId}:${params.stepIndex}`;
  }
  async onBeforeRun(params: { executionId: string; stepIndex: number }) {
    const attempts = this.cache[this.getKey(params)];
    if (!attempts) return null;
    return attempts[0];
  }
  async onAfterRun(params: {
    executionId: string;
    stepIndex: number;
    stepAttempt: number;
    stepDone: boolean;
    stepResponse: {};
  }) {
    const { stepAttempt, stepDone, stepResponse, ...keyParams } = params;
    const key = this.getKey(keyParams);
    const value = {
      response: stepResponse,
      meta: {
        attempt: stepAttempt,
        done: stepDone,
      },
    };
    const attempts = this.cache[key];
    if (!attempts) this.cache[key] = [];
    this.cache[key].unshift(value);
  }
  async onSchedule(executionId: string, timestamp: number) {
    console.log(`[INFO]: Scheduled for ${timestamp}`);
  }
  async onFailure() {}
  async onAbandon() {}
}

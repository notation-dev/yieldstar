import { StepResponse } from "./step-response";

type CacheResponse = {
  response: StepResponse;
  meta: { attempt: number; done: boolean };
};

export abstract class Connector {
  abstract onStart(): Promise<void>;
  abstract onEnd(): Promise<void>;
  abstract onBeforeRun(params: {
    executionId: string;
    stepIndex: number;
  }): Promise<CacheResponse | null>;
  abstract onAfterRun(params: {
    executionId: string;
    stepIndex: number;
    stepAttempt: number;
    stepDone: boolean;
    stepResponse: {};
  }): Promise<void>;
  abstract onSchedule(executionId: string, timestamp: number): Promise<void>;
}

export abstract class WorkerConnector extends Connector {
  abstract onFailure(): Promise<void>;
  abstract onAbandon(): Promise<void>;
}

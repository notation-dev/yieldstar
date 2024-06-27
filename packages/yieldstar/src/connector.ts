type CacheResponse = {
  stepResponseJson: string;
  meta: { attempt: number; done: boolean };
};

export abstract class Connector {
  abstract onStart(): Promise<void>;
  abstract onEnd(): Promise<void>;
  abstract onBeforeRun(params: {
    executionId: string;
    stepKey: string;
  }): Promise<CacheResponse | null>;
  abstract onAfterRun(params: {
    executionId: string;
    stepKey: string;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }): Promise<void>;
  abstract onSchedule(executionId: string, timestamp: number): Promise<void>;
}

export abstract class WorkerConnector extends Connector {
  abstract onFailure(): Promise<void>;
  abstract onAbandon(): Promise<void>;
}

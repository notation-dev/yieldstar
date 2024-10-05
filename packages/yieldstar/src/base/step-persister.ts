export type CacheResponse = {
  stepResponseJson: string;
  meta: { attempt: number; done: boolean };
};

export abstract class StepPersister {
  abstract readStep(params: {
    executionId: string;
    stepKey: string;
  }): Promise<CacheResponse | null>;
  abstract writeStep(params: {
    executionId: string;
    stepKey: string;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }): Promise<void>;
}

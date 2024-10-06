export type HeapRecord = {
  stepResponseJson: string;
  meta: { attempt: number; done: boolean };
};

export abstract class HeapClient {
  abstract readStep(params: {
    executionId: string;
    stepKey: string;
  }): Promise<HeapRecord | null>;
  abstract writeStep(params: {
    executionId: string;
    stepKey: string;
    stepAttempt: number;
    stepDone: boolean;
    stepResponseJson: string;
  }): Promise<void>;
}

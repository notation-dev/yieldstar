export abstract class StepResponse {
  abstract type: string;
}

export class StepKey extends StepResponse {
  type = "step-key";
  value = null;
}

export class StepCacheCheck extends StepResponse {
  type = "cache-check";
}

export class StepInvalid extends StepResponse {
  type = "step-invalid";
}

export class StepResult extends StepResponse {
  type = "step-result";
  result: any;
  constructor(result: any) {
    super();
    this.result = result;
  }
}

export class WorkflowResult<T extends any> extends StepResponse {
  type = "workflow-result";
  result: T;
  constructor(result: T) {
    super();
    this.result = result;
  }
}

export class WorkflowRestart extends StepResponse {
  type = "workflow-restart";
  constructor() {
    super();
  }
}

export class StepError extends StepResponse {
  type = "step-error";
  err: any;
  maxAttempts: number;
  retryInterval: number;
  backOffStrategy: "linear" | "decay";
  constructor(
    err: any,
    opts?: {
      maxAttempts: number;
      retryInterval?: number;
      backoffStrategy?: "linear" | "decay";
    }
  ) {
    super();
    this.err = err;
    this.maxAttempts = opts?.maxAttempts ? opts.maxAttempts : 1;
    this.retryInterval = opts?.retryInterval ? opts.retryInterval : 60000;
    this.backOffStrategy = opts?.backoffStrategy
      ? opts.backoffStrategy
      : "decay";
  }
}

export class StepDelay extends StepResponse {
  type = "step-delay";
  resumeAt: number;
  constructor(resumeAt: number) {
    super();
    this.resumeAt = resumeAt;
  }
}

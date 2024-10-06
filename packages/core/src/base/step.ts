export abstract class StepResponse {
  abstract type: string;
}

export class StepKey extends StepResponse {
  static type = "step-key";
  readonly type = "step-key";
  key: string | null;
  constructor(key: string | null) {
    super();
    this.key = key;
  }
}

export class StepCacheCheck extends StepResponse {
  static type = "cache-check";
  readonly type = "cache-check";
}

export class StepInvalid extends StepResponse {
  static type = "step-invalid";
  readonly type = "step-invalid";
}

export class StepResult extends StepResponse {
  static type = "step-result";
  readonly type = "step-result";
  result: any;
  constructor(result: any) {
    super();
    this.result = result;
  }
}

export class WorkflowResult<T extends any> extends StepResponse {
  static type = "workflow-result";
  readonly type = "workflow-result";
  result: T;
  constructor(result: T) {
    super();
    this.result = result;
  }
}

export class WorkflowDelay extends StepResponse {
  static type = "workflow-delay";
  readonly type = "workflow-delay";
  resumeIn: number;
  constructor(resumeIn: number) {
    super();
    this.resumeIn = resumeIn;
  }
}

export class WorkflowRestart extends StepResponse {
  static type = "workflow-restart";
  readonly type = "workflow-restart";
  constructor() {
    super();
  }
}

export class StepError extends StepResponse {
  static type = "step-error";
  readonly type = "step-error";
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
  static type = "step-delay";
  readonly type = "step-delay";
  resumeIn: number;
  constructor(resumeIn: number) {
    super();
    this.resumeIn = resumeIn;
  }
}

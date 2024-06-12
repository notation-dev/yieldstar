export abstract class StepResponse {
  abstract type: string;
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

export class WorkflowResult extends StepResponse {
  type = "workflow-result";
  result: any;
  constructor(result: any) {
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
  attempts: number;
  timeout: number;
  backOffStrategy: "linear" | "decay";
  constructor(
    err: any,
    opts?: {
      attempts: number;
      timeout?: number;
      backoffStrategy?: "linear" | "decay";
    }
  ) {
    super();
    this.err = err;
    this.attempts = opts?.attempts ? opts.attempts : 1;
    this.timeout = opts?.timeout ? opts.timeout : 60000;
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

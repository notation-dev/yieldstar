import { serializeError, deserializeError } from "serialize-error";
import {
  StepDelay,
  StepError,
  StepResult,
  StepResponse,
  WorkflowResult,
} from "./step-response";

export function serialize(data: StepResponse): string {
  const replaceErrors = (key: string, value: any) => {
    if (value instanceof Error) {
      return serializeError(value);
    }
    return value;
  };

  return JSON.stringify(data, replaceErrors);
}

export function deserialize(jsonString: string): StepResponse {
  const reviveErrors = (key: string, value: any) => {
    if (value && value.name && value.message && value.stack) {
      return deserializeError(value);
    }
    return value;
  };

  const stepResponse = JSON.parse(jsonString, reviveErrors);

  switch (stepResponse.type) {
    case "step-error":
      const { err, ...params } = stepResponse;
      return new StepError(stepResponse.err, params);
    case "step-delay":
      return new StepDelay(stepResponse.resumeAt);
    case "step-result":
      return new StepResult(stepResponse.result);
    case "workflow-result":
      return new WorkflowResult(stepResponse.result);
    default:
      throw new Error("Unknown step result type: " + stepResponse.type);
  }
}

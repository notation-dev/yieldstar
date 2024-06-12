import { Connector } from "./connector";
import { isIterable } from "./utils";
import {
  StepResponse,
  StepError,
  StepResult,
  StepDelay,
  StepCacheCheck,
  StepInvalid,
  WorkflowResult,
} from "./step-response";
import { RetryableError } from "./errors";

/**
 * @description A library of step generators, each of which:
 * @yields a StepResponse to workflow consumers
 * @returns the result of executing a user-defined function, or
 * @returns the cached result from a previous run, or
 * @throws any error caught when running the user-defined function,
 * once retries have been exhausted, or if there are no retry semantics
 */
const stepRunner = {
  async *run<T extends any>(
    fn: () => T | Promise<T>
  ): AsyncGenerator<StepResponse, T, StepResult | StepError> {
    const cached = yield new StepCacheCheck();
    if (cached) {
      yield cached;
      if (cached instanceof StepError) {
        // unreachable – consumer calls throw() on the generator first
        throw cached.err;
      }
      return cached.result;
    }
    try {
      const result = await fn();
      yield new StepResult(result);
      return result;
    } catch (err: unknown) {
      if (err instanceof RetryableError) {
        yield new StepError(err, { attempts: err.attempts });
      } else {
        yield new StepError(err);
      }
      // unreachable – consumer calls throw() on the generator first
      throw err;
    }
  },
  async *delay(interval: number): AsyncGenerator<any, void, StepDelay> {
    const cached = yield new StepCacheCheck();
    if (cached) {
      yield new StepDelay(cached.resumeAt);
    } else {
      yield new StepDelay(Date.now() + interval);
    }
  },
};

export function createWorkflow(
  workflowFn: (step: typeof stepRunner) => AsyncGenerator<any>
) {
  /**
   * @description Consumes workflow steps, handling any workflow logic, and
   * yielding control to a worker (composite step consumer) to do async work
   * @yields {StepResponse}
   */
  return async function* compositeStepGenerator(params: {
    executionId: string;
    connector: Connector;
  }): AsyncGenerator<StepResponse, StepResult | void, StepResponse> {
    const workflowIterator = workflowFn(stepRunner);
    const { executionId, connector } = params;

    let stepIndex = -1;
    let iteratorResult: IteratorResult<any> | null = null;
    let nextIteratorResult: IteratorResult<any> | null = null;

    while (true) {
      stepIndex++;
      let stepAttempt = 0;

      // 0. Retrieve from cache any previous responses from the step
      let cached = await connector.onBeforeRun({
        executionId,
        stepIndex,
      });

      // 1. Check if this is the first time workflow has ever been run
      if (stepIndex === 0 && !cached) {
        connector.onStart();
      }

      // 2. If the step needs to be retried, don't use cached value, and increment attempt counter
      if (cached?.meta && cached.meta.done === false) {
        stepAttempt = cached.meta.attempt + 1;
        cached = null;
      }

      // 3. Advance workflow.
      //    If we already have the next iterator result from a previous iteration, use that
      if (nextIteratorResult) {
        iteratorResult = nextIteratorResult;
        nextIteratorResult = null;
      } else {
        iteratorResult = await workflowIterator.next();
      }

      let stepResponse: StepResponse = iteratorResult.value;

      // 4. If the first yielded value is a cache check, advance to actual step, passing it the cached value
      if (stepResponse instanceof StepCacheCheck) {
        iteratorResult = await workflowIterator.next(cached?.response);
        stepResponse = iteratorResult.value;
      }

      // 5. When the workflow returns, wrap the return value in a result type
      if (iteratorResult.done) {
        stepResponse = new WorkflowResult(iteratorResult.value);
      }

      // 6. Check for invalid iterators
      if (isIterable(stepResponse)) {
        console.log("[ERR] Steps must be yielded using yield*\n");
        stepResponse = new StepInvalid();
      } else if (!(stepResponse instanceof StepResponse)) {
        console.log(
          `[ERR] Iterators should yield a StepResponse. Got ${JSON.stringify(
            stepResponse
          )}`
        );
        stepResponse = new StepInvalid();
      }

      // 7. Determine if step needs to be retried
      const needsRetry =
        stepResponse instanceof StepError &&
        stepResponse.attempts > stepAttempt;

      // 8. If this step attempt is not already cached, cache it
      if (!cached) {
        await connector.onAfterRun({
          executionId,
          stepIndex,
          stepAttempt,
          stepDone: !needsRetry,
          stepResponse,
        });
      }

      // 9. Once the WorkflowResult is cached, return the WorkflowResult to the worker
      if (stepResponse instanceof WorkflowResult) {
        return stepResponse;
      }

      // 10. Once invalid iterator steps have been cached, stop workflow execution
      if (stepResponse instanceof StepInvalid) {
        break;
      }

      // 11. If step runner yielded a step error, throw the error back
      //    into step runner generator for the user to handle.
      //    This also advances the workflow, so store the next iterator result,
      //    and continue to the next iteration.
      if (stepResponse instanceof StepError) {
        if (needsRetry) {
          yield new StepDelay(stepResponse.timeout);
        } else {
          nextIteratorResult = await workflowIterator.throw(stepResponse.err);
        }
      }

      // 12. If delay has elapsed, continue now to next step
      if (stepResponse instanceof StepDelay) {
        if (stepResponse.resumeAt <= Date.now()) {
          continue;
        }
      }

      // 13. Yield control back to worker if step is not a result i.e. async work is required.
      //    (Whenever we receive a StepResult, it's always possible to continue straight to the next step).
      if (!(stepResponse instanceof StepResult)) {
        yield stepResponse;
      }
    }
  };
}

export type CompositeStepGenerator = ReturnType<typeof createWorkflow>;

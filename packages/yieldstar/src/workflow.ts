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
import { deserialize, serialize } from "./serialise";

export type StepRunner = typeof stepRunner;
export type WorkflowFn<T> = (step: StepRunner) => AsyncGenerator<any, T>;

export type CompositeStepGenerator<T> = (params: {
  executionId: string;
  connector: Connector;
}) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

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
        yield new StepError(err, {
          maxAttempts: err.maxAttempts,
          retryInterval: err.retryInterval,
        });
      } else {
        yield new StepError(err);
      }
      // unreachable – consumer calls throw() on the generator first
      throw err;
    }
  },
  async *delay(retryInterval: number): AsyncGenerator<any, void, StepDelay> {
    const cached = yield new StepCacheCheck();
    if (cached) {
      yield new StepDelay(cached.resumeAt);
    } else {
      yield new StepDelay(Date.now() + retryInterval);
    }
  },
  async *poll(
    opts: { maxAttempts: number; retryInterval: number },
    predicate: () => boolean | Promise<boolean>
  ) {
    yield* stepRunner.run(async () => {
      if (!(await predicate())) {
        throw new RetryableError("Polling reached max retries", {
          maxAttempts: opts.maxAttempts,
          retryInterval: opts.retryInterval,
        });
      }
    });
  },
};

export function createWorkflow<T>(
  workflowFn: WorkflowFn<T>
): CompositeStepGenerator<T> {
  /**
   * @description Consumes workflow steps, handling any workflow logic, and
   * yielding control to a worker (composite step consumer) to do async work
   * @yields {StepResponse}
   */
  return async function* compositeStepGenerator(params) {
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

      // 2. Increment attempt counter. We'll save this after execution.
      if (cached?.meta) {
        stepAttempt = cached.meta.attempt + 1;
      }

      // 3. If the step needs to be retried, don't use cached value
      if (cached?.meta.done === false) {
        cached = null;
      }

      // 4. Advance workflow.
      //    If we already have the next iterator result from a previous iteration, use that
      if (nextIteratorResult) {
        iteratorResult = nextIteratorResult;
        nextIteratorResult = null;
      } else {
        iteratorResult = await workflowIterator.next();
      }

      let stepResponse: StepResponse = iteratorResult.value;

      // 5. If the first yielded value is a cache check, advance to actual step, passing it the cached value
      if (stepResponse instanceof StepCacheCheck) {
        const cachedResponse = cached
          ? deserialize(cached.stepResponseJson)
          : null;
        iteratorResult = await workflowIterator.next(cachedResponse);
        stepResponse = iteratorResult.value;
      }

      // 6. When the workflow returns, wrap the return value in a result type
      if (iteratorResult.done) {
        stepResponse = new WorkflowResult(iteratorResult.value);
      }

      // 7. Check for invalid iterators
      if (isIterable(stepResponse)) {
        console.log("[ERR] Steps must be yielded using yield*\n");
        stepResponse = new StepInvalid();
      } else if (!(stepResponse instanceof StepResponse)) {
        // todo: not throwing here causes a critical error
        console.log(
          `[ERR] Iterators should yield a StepResponse. Got ${JSON.stringify(
            stepResponse
          )}`
        );
        stepResponse = new StepInvalid();
      }

      // 8 Determine if step needs to be retried
      const needsRetry =
        !cached?.meta.done &&
        stepResponse instanceof StepError &&
        // 1-indexed vs 0-indexed
        stepResponse.maxAttempts > stepAttempt + 1;

      // 9. If this step attempt is not already cached, cache it
      if (!cached) {
        await connector.onAfterRun({
          executionId,
          stepIndex,
          stepAttempt,
          stepDone: !needsRetry,
          stepResponseJson: serialize(stepResponse),
        });
      }

      // 10. Once the WorkflowResult is cached, return the WorkflowResult to the worker
      if (stepResponse instanceof WorkflowResult) {
        return stepResponse;
      }

      // 11. Once invalid iterator steps have been cached, stop workflow execution
      if (stepResponse instanceof StepInvalid) {
        break;
      }

      // 12. If step runner yielded a step error, either throw the error back for user to handle,
      //     or yield to worker, if it should be retried
      if (stepResponse instanceof StepError) {
        if (needsRetry) {
          yield new StepDelay(Date.now() + stepResponse.retryInterval);
        }
        // Throwing also advances the workflow, so store the next iterator result,
        // and continue to the next iteration.
        else {
          nextIteratorResult = await workflowIterator.throw(stepResponse.err);
          continue;
        }
      }

      // 13. If delay has elapsed, continue now to next step
      if (stepResponse instanceof StepDelay) {
        if (stepResponse.resumeAt <= Date.now()) {
          continue;
        }
      }

      // 14. Yield control back to worker if step is not a result i.e. async work is required.
      //    (Whenever we receive a StepResult, it's always possible to continue straight to the next step).
      if (!(stepResponse instanceof StepResult)) {
        yield stepResponse;
      }
    }

    throw new Error("Critical error");
  };
}

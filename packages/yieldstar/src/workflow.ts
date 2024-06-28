import { Connector } from "./connector";
import { isIterable } from "./utils";
import {
  StepResponse,
  StepKey,
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
const stepRunner = { run, delay, poll };

function run<T extends any>(
  fn: () => T | Promise<T>
): AsyncGenerator<StepResponse, T, StepResult | StepError>;

function run<T extends any>(
  key: string,
  fn: () => T | Promise<T>
): AsyncGenerator<StepResponse, T, StepResult | StepError>;

async function* run<T extends any>(
  arg1: string | (() => T | Promise<T>),
  arg2?: () => T | Promise<T>
): AsyncGenerator<StepResponse, T, StepResult | StepError> {
  let key: string | null = null;
  let fn: () => T | Promise<T>;

  if (typeof arg1 === "string") {
    key = arg1;
    fn = arg2!;
  } else {
    fn = arg1;
  }

  yield new StepKey(key);

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
}

function delay(retryInterval: number): any;
function delay(key: string, retryInterval: number): any;

async function* delay(
  arg1: string | number,
  arg2?: number
): AsyncGenerator<any, void, StepDelay> {
  let key: string | null = null;
  let retryInterval: number;

  if (typeof arg1 === "string") {
    key = arg1;
    retryInterval = arg2!;
  } else {
    retryInterval = arg1;
  }

  yield new StepKey(key);

  const cached = yield new StepCacheCheck();

  if (cached) {
    yield new StepDelay(cached.resumeAt);
  } else {
    yield new StepDelay(Date.now() + retryInterval);
  }
}

async function* poll(
  opts: { maxAttempts: number; retryInterval: number },
  predicate: () => boolean | Promise<boolean>
) {
  yield* run(async () => {
    if (!(await predicate())) {
      throw new RetryableError("Polling reached max retries", {
        maxAttempts: opts.maxAttempts,
        retryInterval: opts.retryInterval,
      });
    }
  });
}

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

    let keylessStepIndex = -1;
    let iteratorResult: IteratorResult<any> | null = null;
    let nextIteratorResult: IteratorResult<any> | null = null;

    while (true) {
      let stepAttempt = 0;
      let stepKey: string;

      /**
       * If we already have the next iterator result from a previous iteration
       * (e.g. it threw an error and advanced the workflow),use that, otherwise,
       * advance the workflow generator
       */
      if (nextIteratorResult) {
        iteratorResult = nextIteratorResult;
        nextIteratorResult = null;
      } else {
        iteratorResult = await workflowIterator.next();
      }

      /**
       * Get the StepKey from the step runner.
       * If the StepKey value is null, assume deterministic ordering, and use
       * the step index as a key.
       * If the generator is done, the workflow has returned, so we set a
       * special key for that.
       */
      if (iteratorResult.done) {
        stepKey = "$$workflow-result$$";
      } else if (!(iteratorResult.value instanceof StepKey)) {
        throw new Error("Step runners must yield a StepKey object");
      } else if (iteratorResult.value.key) {
        stepKey = iteratorResult.value.key;
      } else {
        keylessStepIndex++;
        stepKey = `$$step-index-${keylessStepIndex}$$`;
      }

      /**
       * Using the StepKey, retrieve the previous response for this step from
       * the cache
       */
      let cached = await connector.onBeforeRun({
        executionId,
        stepKey,
      });

      /**
       * Increment attempt counter. We'll save this after execution.
       */
      if (cached?.meta) {
        stepAttempt = cached.meta.attempt + 1;
      }

      /**
       * If the step needs to be retried, ignore the cached value
       */
      if (cached?.meta.done === false) {
        cached = null;
      }

      /**
       * If the workflow generator hasn't returned, advance the step runner
       */
      if (!iteratorResult.done) {
        iteratorResult = await workflowIterator.next();
      }

      /**
       * We can now get a StepResponse object from the iterator result.
       * The step runner generator always yields a StepResponse, whereas
       * the workflow generator return value needs to be wrapped.
       */
      let stepResponse: StepResponse;

      if (iteratorResult.done) {
        stepResponse = new WorkflowResult(iteratorResult.value);
      } else {
        stepResponse = iteratorResult.value;
      }

      /**
       * If the first yielded value is a cache check, advance to actual step,
       * passing it the cached value
       */
      if (stepResponse instanceof StepCacheCheck) {
        const cachedResponse = cached
          ? deserialize(cached.stepResponseJson)
          : null;
        iteratorResult = await workflowIterator.next(cachedResponse);
        stepResponse = iteratorResult.value;
      } else if (!(stepResponse instanceof WorkflowResult)) {
        throw new Error("Step runners must yield a CacheCheck object");
      }

      /**
       * Check for invalid iterators e.g. developer didn't use yield* or didn't
       * use a step runner
       */
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
      // todo: not throwing here causes a critical error – should workflow break?

      /**
       * Determine if step needs to be retried
       */
      const needsRetry =
        !cached?.meta.done &&
        stepResponse instanceof StepError &&
        // 1-indexed vs 0-indexed
        stepResponse.maxAttempts > stepAttempt + 1;

      /**
       * If this step attempt is not already cached, cache it
       */
      if (!cached) {
        await connector.onAfterRun({
          executionId,
          stepKey,
          stepAttempt,
          stepDone: !needsRetry,
          stepResponseJson: serialize(stepResponse),
        });
      }

      /**
       * Once the WorkflowResult is cached, return the WorkflowResult to the
       * upstream consumer e.g the worker
       */
      if (stepResponse instanceof WorkflowResult) {
        return stepResponse;
      }

      /**
       * Once invalid iterator steps have been cached, stop execution
       */
      if (stepResponse instanceof StepInvalid) {
        break;
      }

      /**
       * If step runner yielded a step error, either throw the error back for
       * user to handle, or yield to worker, if it should be retried.
       * (Throwing also advances the workflow generator, so, in that case, we
       * store the next iterator result, and continue to the next step).
       */
      if (stepResponse instanceof StepError) {
        if (needsRetry) {
          yield new StepDelay(Date.now() + stepResponse.retryInterval);
        } else {
          nextIteratorResult = await workflowIterator.throw(stepResponse.err);
          continue;
        }
      }

      /**
       * If the delay has already elapsed, continue straight to next step
       */
      if (stepResponse instanceof StepDelay) {
        if (stepResponse.resumeAt <= Date.now()) {
          continue;
        }
      }

      /**
       * Yield control back to the worker if the stepResponse is not a result
       * i.e. async work is required. (Whenever we receive a StepResult, it's
       * always possible to continue straight to the next step).
       */
      if (!(stepResponse instanceof StepResult)) {
        yield stepResponse;
      }
    }

    /**
     * If we arrive here, something has gone wrong internally
     */
    throw new Error("Critical error");
  };
}

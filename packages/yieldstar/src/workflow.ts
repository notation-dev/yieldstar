import type { StepRunner } from "./step-runner";
import { stepRunner } from "./step-runner";
import { Connector } from "./connector";
import { isIterable } from "./utils";
import { deserialize, serialize } from "./serialise";
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

export type WorkflowFn<T> = (step: StepRunner) => AsyncGenerator<any, T>;

export type CompositeStepGenerator<T> = (params: {
  executionId: string;
  connector: Connector;
}) => AsyncGenerator<StepResponse, WorkflowResult<T>, StepResponse>;

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

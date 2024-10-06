import {
  StepResponse,
  StepKey,
  StepError,
  StepResult,
  StepDelay,
  StepCacheCheck,
} from "@yieldstar/core";
import { RetryableError } from "../exports/errors";

/**
 * @description A library of step generators, each of which:
 * @yields a StepResponse to workflow consumers
 * @returns the result of executing a user-defined function, or
 * @returns the cached result from a previous run, or
 * @throws any error caught when running the user-defined function,
 * once retries have been exhausted, or if there are no retry semantics
 */
export const stepRunner = { run, delay, poll };

export type StepRunner = typeof stepRunner;

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
    yield new StepDelay(cached.resumeIn);
  } else {
    yield new StepDelay(Date.now() + retryInterval);
  }
}

type PollOpts = { maxAttempts: number; retryInterval: number };
type PollPredicate = () => boolean | Promise<boolean>;

function poll(opts: PollOpts, predicate: PollPredicate): any;
function poll(key: string, opts: PollOpts, predicate: PollPredicate): any;

async function* poll(
  arg1: string | PollOpts,
  arg2: PollOpts | PollPredicate,
  arg3?: PollPredicate
) {
  let key: string | null = null;
  let opts: PollOpts;
  let predicate: PollPredicate;

  if (typeof arg1 === "string") {
    key = arg1;
    opts = arg2 as PollOpts;
    predicate = arg3 as PollPredicate;
  } else {
    opts = arg1;
    predicate = arg2 as PollPredicate;
  }

  const task = async () => {
    if (!(await predicate())) {
      throw new RetryableError("Polling reached max retries", {
        maxAttempts: opts.maxAttempts,
        retryInterval: opts.retryInterval,
      });
    }
  };

  if (key) {
    yield* run(key, task);
  } else {
    yield* run(task);
  }
}

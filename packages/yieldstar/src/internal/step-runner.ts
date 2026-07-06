import {
  cloneStoreState,
  defineStore,
  type Draft,
  type StandardSchemaV1,
  StepResponse,
  StepKey,
  StepError,
  StepResult,
  StepDelay,
  StepCacheCheck,
  StepStoreWait,
  type StoreClient,
  type StoreDefinition,
  type StoreKey,
  type StoreSelector,
  type StoreSnapshot,
  type StoreState,
  type StoreTakeResult,
  type StoreUpdateResult,
  trackStoreSelector,
} from "@yieldstar/core";
import { RetryableError } from "../exports/errors";
import { getCallSiteHash } from "./utils";
import type { WorkflowEvent } from "@yieldstar/core";

/**
 * @description A library of step generators, each of which:
 * @yields a StepResponse to workflow consumers
 * @returns the result of executing a user-defined function, or
 * @returns the cached result from a previous run, or
 * @throws any error caught when running the user-defined function,
 * once retries have been exhausted, or if there are no retry semantics
 */
export { defineStore };

export type WorkflowStore<T> = {
  readonly definition: StoreDefinition<any>;
  readonly id: string;
  readonly key: StoreKey;
  get(key?: string): AsyncGenerator<StepResponse, StoreSnapshot<T>>;
  select<R>(
    key: string,
    selector: StoreSelector<T, R>
  ): AsyncGenerator<StepResponse, R>;
  update(
    key: string,
    updater: (draft: Draft<T>) => void | T | Promise<void | T>
  ): AsyncGenerator<StepResponse, StoreUpdateResult<T>>;
  when<R>(
    selector: StoreSelector<T, R | undefined | null | false>
  ): AsyncGenerator<StepResponse, NonNullable<R>>;
  when<R>(
    key: string,
    selector: StoreSelector<T, R | undefined | null | false>
  ): AsyncGenerator<StepResponse, NonNullable<R>>;
  take<R>(
    key: string,
    selector: StoreSelector<T, R | undefined | null | false>,
    claim: (draft: Draft<T>, selected: NonNullable<R>) => void
  ): AsyncGenerator<StepResponse, NonNullable<R>>;
};

export type StepRunner = ReturnType<typeof createStepRunner>;

export function createStepRunner(params: {
  event: WorkflowEvent;
  storeClient: StoreClient;
}) {
  const { event, storeClient } = params;

  function store<Schema extends StandardSchemaV1>(
    definition: StoreDefinition<Schema>,
    params?: {
      id?: string;
      initial?:
        | StoreState<Schema>
        | (() => StoreState<Schema> | Promise<StoreState<Schema>>);
    }
  ): AsyncGenerator<StepResponse, WorkflowStore<StoreState<Schema>>> {
    const id = params?.id ?? event.executionId;
    const key = `store:${definition.name}:${id}`;

    return storeStep({
      key,
      definition,
      id,
      event,
      storeClient,
      initial: params?.initial,
    });
  }

  return { run, delay, poll, store };
}

async function* storeStep<Schema extends StandardSchemaV1>(params: {
  key: string;
  definition: StoreDefinition<Schema>;
  id: string;
  event: WorkflowEvent;
  storeClient: StoreClient;
  initial?:
    | StoreState<Schema>
    | (() => StoreState<Schema> | Promise<StoreState<Schema>>);
}): AsyncGenerator<
  StepResponse,
  WorkflowStore<StoreState<Schema>>,
  StepResult | StepError
> {
  const { key, definition, id, event, storeClient, initial } = params;

  yield new StepKey(key);

  const cached = yield new StepCacheCheck();

  if (cached) {
    yield cached;
    if (cached instanceof StepError) {
      throw cached.err;
    }
    return createWorkflowStore({
      definition,
      id,
      event,
      storeClient,
    });
  }

  try {
    await storeClient.getOrCreateStore({
      definition,
      id,
      initial,
    });
    yield new StepResult({ storeName: definition.name, storeId: id });
    return createWorkflowStore({
      definition,
      id,
      event,
      storeClient,
    });
  } catch (err: unknown) {
    yield new StepError(err);
    throw err;
  }
}

function createWorkflowStore<T>(params: {
  definition: StoreDefinition<any>;
  id: string;
  event: WorkflowEvent;
  storeClient: StoreClient;
}): WorkflowStore<T> {
  const { definition, id, event, storeClient } = params;
  const key = { storeName: definition.name, storeId: id };

  return {
    definition,
    id,
    key,
    get(stepKey?: string) {
      return durableStep<StoreSnapshot<T>>(stepKey ?? getCallSiteHash(this.get), async () =>
        (await storeClient.getStore({ definition, id })) as StoreSnapshot<T>
      );
    },
    select<R>(stepKey: string, selector: StoreSelector<T, R>) {
      return durableStep(stepKey, async () => {
        const snapshot = await storeClient.getStore({ definition, id });
        // Run the selector against a clone so accidental mutation cannot
        // corrupt shared state (consistent with when, which throws via
        // its tracking proxy).
        return selector(cloneStoreState(snapshot.state as T));
      });
    },
    update(stepKey, updater) {
      return durableStep<StoreUpdateResult<T>>(stepKey, async () =>
        (await storeClient.updateStore({
          definition,
          id,
          updater: updater as any,
        })) as StoreUpdateResult<T>
      );
    },
    when<R>(
      arg1:
        | string
        | StoreSelector<T, R | undefined | null | false>,
      arg2?: StoreSelector<T, R | undefined | null | false>
    ) {
      const stepKey =
        typeof arg1 === "string" ? arg1 : getCallSiteHash(this.when);
      const selector = (
        typeof arg1 === "string" ? arg2 : arg1
      ) as StoreSelector<T, R | undefined | null | false>;

      return whenStep({
        definition,
        id,
        event,
        storeClient,
        stepKey,
        selector,
      });
    },
    take<R>(
      stepKey: string,
      selector: StoreSelector<T, R | undefined | null | false>,
      claim: (draft: Draft<T>, selected: NonNullable<R>) => void
    ) {
      return takeStep({
        definition,
        id,
        event,
        storeClient,
        stepKey,
        selector,
        claim,
      });
    },
  };
}

function run<T extends any>(
  fn: () => T | Promise<T>,
): AsyncGenerator<StepResponse, T, StepResult | StepError>;

function run<T extends any>(
  key: string,
  fn: () => T | Promise<T>,
): AsyncGenerator<StepResponse, T, StepResult | StepError>;

async function* run<T extends any>(
  arg1: string | (() => T | Promise<T>),
  arg2?: (() => T | Promise<T>) | string,
): AsyncGenerator<StepResponse, T, StepResult | StepError> {
  let key: string | null = null;
  let fn: () => T | Promise<T>;

  if (typeof arg1 === "string") {
    key = arg1;
    fn = arg2 as () => T | Promise<T>;
  } else {
    fn = arg1;
  }

  if (!key) key = getCallSiteHash(run);

  return yield* durableStep(key, fn);
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

  if (!key) key = getCallSiteHash(delay);

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

  if (!key) key  = getCallSiteHash(poll);

  const task = async () => {
    if (!(await predicate())) {
      throw new RetryableError("Polling reached max retries", {
        maxAttempts: opts.maxAttempts,
        retryInterval: opts.retryInterval,
      });
    }
  };

  yield* run(key, task, );
}

async function* durableStep<T extends any>(
  key: string,
  fn: () => T | Promise<T>
): AsyncGenerator<StepResponse, T, StepResult | StepError> {
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

async function* whenStep<T, R>(params: {
  definition: StoreDefinition<any>;
  id: string;
  event: WorkflowEvent;
  storeClient: StoreClient;
  stepKey: string;
  selector: StoreSelector<T, R | undefined | null | false>;
}): AsyncGenerator<StepResponse, NonNullable<R>, StepResult | StepStoreWait> {
  const { definition, id, event, storeClient, stepKey, selector } = params;

  yield new StepKey(stepKey);

  const cached = yield new StepCacheCheck();

  if (cached) {
    yield cached;
    if (!(cached instanceof StepResult)) {
      throw new Error("Store wait step cache must resolve to a step result");
    }
    return cached.result;
  }

  const snapshot = await storeClient.getStore({ definition, id });
  const { result, readPaths } = trackStoreSelector(
    cloneStoreState(snapshot.state as T),
    selector
  );

  if (result !== undefined && result !== null && result !== false) {
    const clonedResult = cloneStoreState(result);
    yield new StepResult(clonedResult);
    return clonedResult as NonNullable<R>;
  }

  await storeClient.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey,
    event,
    storeName: definition.name,
    storeId: id,
    sinceVersion: snapshot.version,
    readPaths,
  });

  yield new StepStoreWait();

  throw new Error("Store wait yielded control unexpectedly");
}

async function* takeStep<T, R>(params: {
  definition: StoreDefinition<any>;
  id: string;
  event: WorkflowEvent;
  storeClient: StoreClient;
  stepKey: string;
  selector: StoreSelector<T, R | undefined | null | false>;
  claim: (draft: Draft<T>, selected: NonNullable<R>) => void;
}): AsyncGenerator<StepResponse, NonNullable<R>, StepResult | StepStoreWait> {
  const { definition, id, event, storeClient, stepKey, selector, claim } =
    params;

  yield new StepKey(stepKey);

  const cached = yield new StepCacheCheck();

  if (cached) {
    yield cached;
    if (!(cached instanceof StepResult)) {
      throw new Error("Store take step cache must resolve to a step result");
    }
    return cached.result;
  }

  let outcome: StoreTakeResult<R>;
  try {
    outcome = await storeClient.takeFromStore({
      definition,
      id,
      selector: selector as any,
      claim: claim as any,
    });
  } catch (err: unknown) {
    yield new StepError(err);
    // unreachable – consumer calls throw() on the generator first
    throw err;
  }

  if (outcome.matched) {
    yield new StepResult(outcome.selected);
    return outcome.selected as NonNullable<R>;
  }

  await storeClient.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey,
    event,
    storeName: definition.name,
    storeId: id,
    sinceVersion: outcome.version,
    readPaths: outcome.readPaths,
  });

  yield new StepStoreWait();

  throw new Error("Store take yielded control unexpectedly");
}

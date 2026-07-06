import type { WorkflowEvent } from "./event";

export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) =>
      | StandardSchemaV1.Result<Output>
      | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
};

export namespace StandardSchemaV1 {
  export type Issue = {
    readonly message: string;
    readonly path?: readonly PropertyKey[];
  };

  export type Result<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly Issue[] };

  export type InferOutput<Schema extends StandardSchemaV1> =
    Schema extends StandardSchemaV1<any, infer Output> ? Output : never;
}

export type Draft<T> = T extends object
  ? { -readonly [K in keyof T]: Draft<T[K]> }
  : T;

export type StoreVersion = number;
export type StorePath = readonly (string | number)[];

export type StoreDefinition<Schema extends StandardSchemaV1 = StandardSchemaV1> =
  {
    name: string;
    schema: Schema;
  };

export type StoreState<Schema extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<Schema>;

export type StoreKey = {
  storeName: string;
  storeId: string;
};

/**
 * Identifies the durable workflow step performing a store operation.
 * When provided to `updateStore`/`takeFromStore`, the store client records
 * the committed result in an applied-steps ledger keyed by
 * (storeName, storeId, executionId, stepKey), written atomically with the
 * state change. A retried call with the same StoreStepId returns the recorded
 * result without re-running the updater/selector/claim, making the operation
 * exactly-once even if the caller crashes before persisting its own record
 * of the result (e.g. the workflow heap write).
 */
export type StoreStepId = {
  executionId: string;
  stepKey: string;
};

export type StoreSnapshot<T> = {
  state: T;
  version: StoreVersion;
};

export type StoreUpdateResult<T> = {
  state: T;
  previousVersion: StoreVersion;
  version: StoreVersion;
};

export type StoreSelector<T, R> = (state: Readonly<T>) => R;

export type StoreTakeResult<R> =
  | { matched: true; selected: NonNullable<R>; version: StoreVersion }
  | { matched: false; version: StoreVersion; readPaths: StorePath[] };

export type StoreWaiter = {
  workflowId: string;
  executionId: string;
  stepKey: string;
  event: WorkflowEvent;
  storeName: string;
  storeId: string;
  sinceVersion: StoreVersion;
  readPaths: StorePath[];
};

export type RuntimeStore<T> = {
  get(): Promise<StoreSnapshot<T>>;
  update(
    updater: (draft: Draft<T>) => void | T | Promise<void | T>
  ): Promise<StoreUpdateResult<T>>;
};

export function defineStore<Schema extends StandardSchemaV1>(
  name: string,
  schema: Schema
): StoreDefinition<Schema> {
  return { name, schema };
}

export abstract class StoreClient {
  store<Schema extends StandardSchemaV1>(
    definition: StoreDefinition<Schema>,
    id: string
  ): RuntimeStore<StoreState<Schema>> {
    return {
      get: () =>
        this.getStore({
          definition,
          id,
        }),
      update: (updater) =>
        this.updateStore({
          definition,
          id,
          updater,
        }),
    };
  }

  abstract getOrCreateStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    initial?:
      | StoreState<Schema>
      | (() => StoreState<Schema> | Promise<StoreState<Schema>>);
  }): Promise<StoreSnapshot<StoreState<Schema>>>;

  abstract getStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
  }): Promise<StoreSnapshot<StoreState<Schema>>>;

  /**
   * Updates a store's state atomically.
   * NOTE: Updaters should ideally be synchronous. Although the signature allows async updaters,
   * holding open transactions (e.g. SQLite BEGIN IMMEDIATE) across long-running async steps
   * will block other clients from writing. Avoid network, timers, or other async tasks in updaters.
   *
   * When `stepId` is provided the update is exactly-once per
   * (executionId, stepKey): the committed StoreUpdateResult is recorded in
   * the applied-steps ledger inside the same transaction as the state change,
   * and a repeated call with the same stepId returns the recorded result
   * verbatim without running the updater or bumping the version.
   */
  abstract updateStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
    stepId?: StoreStepId;
  }): Promise<StoreUpdateResult<StoreState<Schema>>>;

  /**
   * Atomically selects and claims from a store. The selector and claim
   * mutation run inside the SAME store update transaction, committing as a
   * single version bump. If the selector does not match, nothing is
   * committed and the store's current version plus the selector's tracked
   * read paths are returned so the caller can register a waiter with the
   * correct sinceVersion (closing the lost-wakeup gap by construction).
   *
   * `claim` must be synchronous – implementations must reject (throw) if it
   * returns a Promise.
   *
   * When `stepId` is provided, a MATCHED (committed) take is recorded in the
   * applied-steps ledger inside the same transaction as the claim commit, and
   * a repeated call with the same stepId returns the recorded outcome without
   * re-running the selector or claim. Unmatched outcomes are NOT recorded:
   * an unmatched take commits nothing and registers a waiter, so it must
   * remain free to re-evaluate the selector on every wake.
   */
  abstract takeFromStore<Schema extends StandardSchemaV1, R>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    selector: StoreSelector<StoreState<Schema>, R>;
    claim: (
      draft: Draft<StoreState<Schema>>,
      selected: NonNullable<R>
    ) => void;
    stepId?: StoreStepId;
  }): Promise<StoreTakeResult<R>>;

  abstract registerWaiter(waiter: StoreWaiter): Promise<void>;
}

export function isStoreSelectorMatch<R>(
  result: R
): result is Exclude<R, undefined | null | false> {
  return result !== undefined && result !== null && result !== false;
}

export function assertSynchronousClaim(claimResult: unknown): void {
  if (
    claimResult &&
    typeof (claimResult as PromiseLike<unknown>).then === "function"
  ) {
    throw new Error("Store take claims must be synchronous");
  }
}

export async function validateStoreState<Schema extends StandardSchemaV1>(
  definition: StoreDefinition<Schema>,
  state: unknown
): Promise<StoreState<Schema>> {
  const result = await definition.schema["~standard"].validate(state);

  if ("issues" in result && result.issues) {
    const messages = result.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid store state for "${definition.name}": ${messages}`);
  }

  return result.value as StoreState<Schema>;
}

export function cloneStoreState<T>(state: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state);
    } catch {
      // Fallback if structuredClone fails (e.g. for Proxy objects in JavaScriptCore)
    }
  }

  return JSON.parse(JSON.stringify(state));
}

/**
 * Diffs two store states and returns the set of changed paths.
 *
 * This is O(total state size), so it is no longer the primary source of
 * changed paths – `trackStoreUpdater` records write paths in O(changes)
 * while the updater runs. The diff remains as the fallback for the cases a
 * recording proxy cannot observe:
 * - the updater RETURNED a replacement state instead of mutating the draft
 * - schema validation returned a transformed copy of the draft
 *
 * NOTE: array splices (insert/remove in the middle) report all shifted
 * indices as changed, which can over-wake waiters. This is safe – wakes are
 * spurious at worst, since replay re-evaluates the selector.
 */
export function diffStorePaths(previous: unknown, next: unknown): StorePath[] {
  const paths: StorePath[] = [];

  function visit(left: unknown, right: unknown, path: StorePath) {
    if (Object.is(left, right)) return;

    if (!isDiffableObject(left) || !isDiffableObject(right)) {
      paths.push(path);
      return;
    }

    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

    for (const key of keys) {
      visit(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        [...path, arrayKeyToPathSegment(key)]
      );
    }
  }

  visit(previous, next, []);
  return collapseStorePaths(paths);
}

const TRACKING_TARGET = Symbol("yieldstar.trackingTarget");

/**
 * Unwraps a tracking proxy (`trackStoreSelector` or `trackStoreUpdater`)
 * one level, back to the object it wraps. When a selector runs over a
 * write-recording draft, the selected value unwraps to the RECORDING proxy,
 * so claim mutations applied through it land on the draft AND are recorded
 * as write paths. Derived values (fresh arrays/objects built inside the
 * selector) are returned as-is.
 */
export function unwrapTrackedValue<V>(value: V): V {
  if (isDiffableObject(value)) {
    const target = (value as Record<PropertyKey, unknown>)[
      TRACKING_TARGET as unknown as string
    ];
    if (target !== undefined) return target as V;
  }
  return value;
}

export function trackStoreSelector<T, R>(
  state: T,
  selector: StoreSelector<T, R>
): { result: R; readPaths: StorePath[] } {
  const paths: StorePath[] = [];
  const proxies = new WeakMap<object, unknown>();

  function track(value: unknown, path: StorePath): unknown {
    if (!isDiffableObject(value)) return value;

    const cached = proxies.get(value);
    if (cached) return cached;

    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (typeof property === "symbol") {
          if (property === TRACKING_TARGET) return target;
          return Reflect.get(target, property, receiver);
        }

        const nextPath = [...path, arrayKeyToPathSegment(property)];
        if (nextPath.length > 0) {
          paths.push(nextPath);
        }

        const child = Reflect.get(target, property, receiver);
        return track(child, nextPath);
      },
      set() {
        throw new Error("Store selectors must not mutate state");
      },
      deleteProperty() {
        throw new Error("Store selectors must not mutate state");
      },
    });

    proxies.set(value, proxy);
    return proxy;
  }

  const result = selector(track(state, []) as Readonly<T>);

  return {
    result,
    readPaths: collapseStorePaths(paths),
  };
}

export type TrackedStoreUpdater<T> = {
  /** Write-recording proxy over the raw draft. Hand this to the updater. */
  draft: T;
  /** The collapsed set of paths written so far (O(changes), not O(state)). */
  writePaths(): StorePath[];
};

/**
 * Wraps a draft in a write-recording Proxy so changed paths can be derived
 * from the updater's own mutations in O(changes) instead of deep-diffing the
 * whole previous/next state (O(state size) – see `diffStorePaths`).
 *
 * - Every `set` and `deleteProperty` through the proxy records its full
 *   path. Mutating array methods are trapped naturally via the index/length
 *   sets they perform: a push onto `messages` records ["messages", 3] (and
 *   ["messages", "length"]), preserving prefix-match wake semantics – a
 *   waiter on ["messages"] still wakes via prefix intersection.
 * - Reads return proxied children so nested mutations are captured, but the
 *   mutation itself lands on the underlying raw draft (Reflect.set on the
 *   target), because the mutated draft becomes the next state.
 * - Values assigned through the proxy are unwrapped (top-level) so the raw
 *   draft never stores a proxy wrapper for the common `draft.a = draft.b`
 *   case. Deeper wrappers (a proxy nested inside a fresh object) are
 *   laundered at commit time: `cloneStoreState` always produces fresh plain
 *   objects (structuredClone rejects proxies and falls back to JSON), and
 *   the SQLite client serializes state through JSON.stringify.
 * - Ambiguous traps (`defineProperty`) record conservatively. Changed paths
 *   only affect wake precision, never state correctness: an extra path is a
 *   spurious wake (safe – replay re-evaluates the selector), while a missed
 *   path would lose a wakeup. When in doubt, over-report.
 *
 * IMPORTANT: this only observes MUTATIONS of the draft. If the updater
 * RETURNS a replacement state instead of mutating (the
 * `updated === undefined ? draft : updated` contract), no writes go through
 * the proxy – callers must detect that case and fall back to
 * `diffStorePaths(previousState, replacement)`.
 */
export function trackStoreUpdater<T>(target: T): TrackedStoreUpdater<T> {
  const paths: StorePath[] = [];
  const proxies = new WeakMap<object, unknown>();

  function record(path: StorePath, property: PropertyKey) {
    if (typeof property === "symbol") {
      // Symbol-keyed writes are invisible to JSON state and read paths;
      // record the parent path so any waiter on it still wakes.
      paths.push(path);
      return;
    }
    paths.push([...path, arrayKeyToPathSegment(String(property))]);
  }

  function track(value: unknown, path: StorePath): unknown {
    if (!isDiffableObject(value)) return value;

    const cached = proxies.get(value);
    if (cached) return cached;

    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (typeof property === "symbol") {
          if (property === TRACKING_TARGET) return target;
          return Reflect.get(target, property, receiver);
        }

        // Read without the proxy receiver so any getters run against the
        // raw draft, then wrap the child so nested mutations are captured.
        const child = Reflect.get(target, property);
        return track(child, [...path, arrayKeyToPathSegment(property)]);
      },
      set(target, property, value) {
        record(path, property);
        // Unwrap so the raw draft never stores a proxy wrapper, and set on
        // the raw target (no proxy receiver) so the draft receives the
        // mutation directly.
        return Reflect.set(target, property, unwrapTrackedValue(value));
      },
      deleteProperty(target, property) {
        record(path, property);
        return Reflect.deleteProperty(target, property);
      },
      defineProperty(target, property, descriptor) {
        record(path, property);
        if ("value" in descriptor) {
          descriptor = { ...descriptor, value: unwrapTrackedValue(descriptor.value) };
        }
        return Reflect.defineProperty(target, property, descriptor);
      },
    });

    proxies.set(value, proxy);
    return proxy;
  }

  return {
    draft: track(target, []) as T,
    writePaths: () => collapseStorePaths(paths),
  };
}

export function storePathsIntersect(
  readPaths: StorePath[],
  writePaths: StorePath[]
): boolean {
  return readPaths.some((readPath) =>
    writePaths.some(
      (writePath) =>
        isPathPrefix(readPath, writePath) || isPathPrefix(writePath, readPath)
    )
  );
}

function collapseStorePaths(paths: StorePath[]): StorePath[] {
  const unique = new Map(paths.map((path) => [path.join("\u0000"), path]));
  return [...unique.values()];
}

function isPathPrefix(prefix: StorePath, path: StorePath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => segment === path[index]);
}

function isDiffableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arrayKeyToPathSegment(key: string): string | number {
  if (/^(0|[1-9]\d*)$/.test(key)) return Number(key);
  return key;
}

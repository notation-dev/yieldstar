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

  abstract updateStore<Schema extends StandardSchemaV1>(params: {
    definition: StoreDefinition<Schema>;
    id: string;
    updater: (
      draft: Draft<StoreState<Schema>>
    ) => void | StoreState<Schema> | Promise<void | StoreState<Schema>>;
  }): Promise<StoreUpdateResult<StoreState<Schema>>>;

  abstract registerWaiter(waiter: StoreWaiter): Promise<void>;
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
    return structuredClone(state);
  }

  return JSON.parse(JSON.stringify(state));
}

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

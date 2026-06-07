import { expect, test } from "bun:test";
import type { StandardSchemaV1 } from "yieldstar";
import { defineStore, workflow } from "yieldstar";
import { createTestSdkFactory } from "@yieldstar/test-utils";
import { sleep } from "bun";

type Message = {
  id: string;
  content: string;
  processed: boolean;
};

type ConversationState = {
  messages: Message[];
  status: "idle" | "working";
};

const ConversationStore = defineStore(
  "conversation",
  schema<ConversationState>()
);

const createSdk = createTestSdkFactory();

test("workflow stores can be created, read, and updated", async () => {
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      initial: { messages: [], status: "idle" },
    });

    const initial = yield* store.get("initial");

    const update = yield* store.update("append", (draft) => {
      draft.messages.push({
        id: "msg-1",
        content: "hello",
        processed: false,
      });
    });

    const current = yield* store.get("current");

    return {
      initial,
      update,
      current,
    };
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(result.initial).toEqual({
    state: { messages: [], status: "idle" },
    version: 0,
  });
  expect(result.update.previousVersion).toBe(0);
  expect(result.update.version).toBe(1);
  expect(result.current).toEqual({
    state: {
      messages: [{ id: "msg-1", content: "hello", processed: false }],
      status: "idle",
    },
    version: 1,
  });
});

test("workflow store updates are idempotent across replay", async () => {
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "replay",
      initial: { messages: [], status: "idle" },
    });

    yield* store.update("append-once", (draft) => {
      draft.messages.push({
        id: "msg-1",
        content: "hello",
        processed: false,
      });
    });

    yield* step.delay("replay-boundary", 1);

    const snapshot = yield* store.get("after-replay");
    return snapshot.state.messages;
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(result).toEqual([
    { id: "msg-1", content: "hello", processed: false },
  ]);
});

test("external store updates wake onChange waiters", async () => {
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "external-wake",
      initial: { messages: [], status: "idle" },
    });

    return yield* store.onChange("next-message", (state) =>
      state.messages.find((message) => !message.processed)
    );
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const resultPromise = sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(5);

  await sdk.store(ConversationStore, "external-wake").update((draft) => {
    draft.messages.push({
      id: "msg-1",
      content: "hello",
      processed: false,
    });
  });

  await expect(resultPromise).resolves.toEqual({
    id: "msg-1",
    content: "hello",
    processed: false,
  });
});

test("execution-local default store id is unique per execution", async () => {
  let firstExecutionId: string | undefined;
  let secondExecutionId: string | undefined;

  const testWorkflow = workflow(async function* (step, event) {
    const store = yield* step.store(ConversationStore, {
      initial: { messages: [], status: "idle" },
    });

    if (event.executionId === "run-1") {
      firstExecutionId = store.id;
      yield* store.update("write", (draft) => {
        draft.status = "working";
      });
    } else {
      secondExecutionId = store.id;
    }

    const snapshot = yield* store.get("final");
    return snapshot.state.status;
  });

  const sdk = createSdk({ workflow: testWorkflow });

  const result1 = await sdk.triggerAndWait({
    workflowId: "workflow",
    executionId: "run-1",
  });
  const result2 = await sdk.triggerAndWait({
    workflowId: "workflow",
    executionId: "run-2",
  });

  expect(firstExecutionId).toBe("run-1");
  expect(secondExecutionId).toBe("run-2");
  expect(result1).toBe("working");
  expect(result2).toBe("idle");
});

test("durable get and select replay stability", async () => {
  let selectCallCount = 0;
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "replay-stability",
      initial: { messages: [], status: "idle" },
    });

    const valGet = yield* store.get("read-get");
    const valSelect = yield* store.select("read-select", (s) => {
      selectCallCount++;
      return s.status;
    });

    yield* step.delay("suspend", 1);

    return { valGet, valSelect };
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const resultPromise = sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(5);
  await sdk.store(ConversationStore, "replay-stability").update((draft) => {
    draft.status = "working";
  });

  const res = await resultPromise;

  expect(res.valGet.state.status).toBe("idle");
  expect(res.valSelect).toBe("idle");
  expect(selectCallCount).toBe(1);
});

test("schema validation on create and update", async () => {
  const strictStateSchema = strictSchema<{ count: number }>((val: any) => {
    if (typeof val !== "object" || val === null || typeof val.count !== "number") {
      return "Count must be a number";
    }
    return undefined;
  });

  const StrictStore = defineStore("strict-store", strictStateSchema);

  const testWorkflowInvalidCreate = workflow(async function* (step) {
    yield* step.store(StrictStore, {
      id: "strict-1",
      initial: { count: "not-a-number" } as any,
    });
  });

  const sdk1 = createSdk({ workflow: testWorkflowInvalidCreate });
  const result1 = await sdk1.triggerAndWait({ workflowId: "workflow" });
  expect(result1).toBeInstanceOf(Error);
  expect((result1 as Error).message).toMatch(/Invalid store state/);

  const testWorkflowInvalidUpdate = workflow(async function* (step) {
    const store = yield* step.store(StrictStore, {
      id: "strict-2",
      initial: { count: 0 },
    });

    yield* store.update("bad-update", (draft) => {
      draft.count = "invalid" as any;
    });
  });

  const sdk2 = createSdk({ workflow: testWorkflowInvalidUpdate });
  const result2 = await sdk2.triggerAndWait({ workflowId: "workflow" });
  expect(result2).toBeInstanceOf(Error);
  expect((result2 as Error).message).toMatch(/Invalid store state/);
});

test("onChange returns immediately when selector matches", async () => {
  let ranStep = false;
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "immediate-match",
      initial: { messages: [], status: "working" },
    });

    const status = yield* store.onChange("wait-working", (s) =>
      s.status === "working" ? s.status : false
    );

    ranStep = true;
    return status;
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const result = await sdk.triggerAndWait({ workflowId: "workflow" });

  expect(ranStep).toBe(true);
  expect(result).toBe("working");
});

test("workflow update wakes another waiting workflow", async () => {
  const waiterWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "shared-wake",
      initial: { messages: [], status: "idle" },
    });

    return yield* store.onChange("wait-status", (s) =>
      s.status === "working" ? s.status : false
    );
  });

  const updaterWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "shared-wake",
      initial: { messages: [], status: "idle" },
    });

    yield* store.update("set-status", (draft) => {
      draft.status = "working";
    });
  });

  const router = {
    waiter: waiterWorkflow,
    updater: updaterWorkflow,
  };

  const sdk = createSdk(router);
  const waiterPromise = sdk.triggerAndWait({ workflowId: "waiter" });

  await sleep(5);
  await sdk.trigger({ workflowId: "updater" });

  await expect(waiterPromise).resolves.toBe("working");
});

test("unrelated paths do not wake waiters", async () => {
  let wakeCount = 0;

  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "unrelated-paths",
      initial: { messages: [], status: "idle" },
    });

    wakeCount++;

    return yield* store.onChange("wait-messages", (state) =>
      state.messages.length > 0 ? state.messages : false
    );
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const resultPromise = sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(5);

  await sdk.store(ConversationStore, "unrelated-paths").update((draft) => {
    draft.status = "working";
  });

  await sleep(5);
  expect(wakeCount).toBe(1);

  await sdk.store(ConversationStore, "unrelated-paths").update((draft) => {
    draft.messages.push({ id: "msg-1", content: "hello", processed: false });
  });

  const res = await resultPromise;
  expect(wakeCount).toBe(2);
  expect(res).toEqual([{ id: "msg-1", content: "hello", processed: false }]);
});

test("replacing an ancestor path wakes descendant waiters", async () => {
  const testWorkflow = workflow(async function* (step) {
    const store = yield* step.store(ConversationStore, {
      id: "ancestor-wake",
      initial: { messages: [{ id: "msg-1", content: "hello", processed: false }], status: "idle" },
    });

    return yield* store.onChange("wait-descendant", (state) =>
      state.messages[0]?.processed ? "done" : false
    );
  });

  const sdk = createSdk({ workflow: testWorkflow });
  const resultPromise = sdk.triggerAndWait({ workflowId: "workflow" });

  await sleep(5);

  await sdk.store(ConversationStore, "ancestor-wake").update((draft) => {
    draft.messages = [{ id: "msg-1", content: "hello", processed: true }];
  });

  await expect(resultPromise).resolves.toBe("done");
});

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "yieldstar-test",
      validate(value) {
        return { value: value as T };
      },
    },
  };
}

function strictSchema<T>(validator: (v: unknown) => string | undefined): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "yieldstar-test",
      validate(value) {
        const error = validator(value);
        if (error) {
          return { issues: [{ message: error }] };
        }
        return { value: value as T };
      },
    },
  };
}

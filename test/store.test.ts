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

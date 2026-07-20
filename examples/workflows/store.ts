import type { StandardSchemaV1 } from "yieldstar";
import { defineStore, workflow } from "yieldstar";

type ConversationState = {
  messages: Array<{
    id: string;
    content: string;
  }>;
};

const ConversationStore = defineStore(
  "conversation",
  schema<ConversationState>()
);

export const storeWorkflow = workflow<
  { conversationId: string; content: string },
  ConversationState
>(async function* (step, event) {
  const conversation = yield* step.store(ConversationStore, {
    id: event.params.conversationId,
    initial: { messages: [] },
  });

  yield* conversation.update("append-message", (draft) => {
    draft.messages.push({
      id: crypto.randomUUID(),
      content: event.params.content,
    });
  });

  const snapshot = yield* conversation.get("read-conversation");
  return snapshot.state;
});

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "example",
      validate(value) {
        return { value: value as T };
      },
    },
  };
}

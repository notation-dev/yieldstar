import * as v from "valibot";
import { defineStore, workflow } from "yieldstar";

const ConversationSchema = v.object({
  messages: v.array(
    v.object({
      id: v.string(),
      content: v.string(),
    })
  ),
});

type ConversationState = v.InferOutput<typeof ConversationSchema>;

const ConversationStore = defineStore("conversation", ConversationSchema);

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

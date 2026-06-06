import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  defineStore,
  type SchedulerClient,
  type StandardSchemaV1,
  type WorkflowEvent,
} from "@yieldstar/core";
import { SqliteStoreClient } from "./sqlite-store";

type State = {
  messages: { id: string }[];
};

const Store = defineStore("sqlite-test", schema<State>());

test("sqlite store updates wake matching waiters", async () => {
  const db = new Database(":memory:");
  const events: WorkflowEvent[] = [];
  const schedulerClient: SchedulerClient = {
    async requestWakeUp(event) {
      events.push(event);
    },
  };
  const client = new SqliteStoreClient({ db, schedulerClient });
  const event = {
    workflowId: "workflow",
    executionId: "execution",
    params: undefined,
    context: new Map(),
  };

  await client.getOrCreateStore({
    definition: Store,
    id: "one",
    initial: { messages: [] },
  });
  await client.registerWaiter({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "next-message",
    event,
    storeName: Store.name,
    storeId: "one",
    sinceVersion: 0,
    readPaths: [["messages"]],
  });
  await client.updateStore({
    definition: Store,
    id: "one",
    updater(draft) {
      draft.messages.push({ id: "msg-1" });
    },
  });

  expect(events).toEqual([event]);
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

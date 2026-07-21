import type {
  SchedulerClient,
  StoreClient,
  StorePath,
  StoreWaiter,
  WorkflowEvent,
} from "@yieldstar/core";

export type StoreClientHarness = {
  client: StoreClient;
  dispose(): void | Promise<void>;
};

export type StoreClientTarget = {
  name: string;
  create(schedulerClient: SchedulerClient): StoreClientHarness | Promise<StoreClientHarness>;
};

export type SharedStoreClientTarget = {
  name: string;
  create(schedulerClients: [SchedulerClient, SchedulerClient]):
    | (Omit<StoreClientHarness, "client"> & { clients: [StoreClient, StoreClient] })
    | Promise<Omit<StoreClientHarness, "client"> & { clients: [StoreClient, StoreClient] }>;
};

export type DurableStoreClientTarget = {
  name: string;
  create(schedulerClient: SchedulerClient):
    | (StoreClientHarness & {
        restart(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
      })
    | Promise<
        StoreClientHarness & {
          restart(schedulerClient: SchedulerClient): StoreClient | Promise<StoreClient>;
        }
      >;
};

export type StoreConformanceCase = {
  name: string;
  run(): void | Promise<void>;
};

export function collectStoreConformanceCases(): {
  cases: StoreConformanceCase[];
  addCase(name: string, run: () => void | Promise<void>): void;
} {
  const cases: StoreConformanceCase[] = [];
  return {
    cases,
    addCase(name, run) {
      cases.push({ name, run });
    },
  };
}

export function storeWaiter(event: WorkflowEvent) {
  return (
    storeName: string,
    storeId: string,
    instanceId: string,
    sinceVersion: number
  ): StoreWaiter => ({
    workflowId: event.workflowId,
    executionId: event.executionId,
    stepKey: "wait",
    event,
    storeName,
    storeId,
    instanceId,
    sinceVersion,
    readPaths: [["messages"]] satisfies StorePath[],
  });
}

export function noopScheduler(): SchedulerClient {
  return { async requestWakeUp() {} };
}

export function collectingScheduler(events: WorkflowEvent[]): SchedulerClient {
  return {
    async requestWakeUp(event) {
      events.push(event);
    },
  };
}

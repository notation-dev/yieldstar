import pino from "pino";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { createLocalSdk } from "yieldstar";
import { sqliteEventLoop } from "./shared";
import type { WorkflowRouter } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

export const invoker = createWorkflowInvoker({ workerPath, logger });
export const sdk = createLocalSdk<WorkflowRouter>(invoker);

sqliteEventLoop.start({ onNewEvent: invoker.execute, logger });

try {
  const result = await sdk.triggerAndWait({
    workflowId: "dynamic-workflow",
    params: { msg: "hello" },
  });
  console.log(result);
} finally {
  sqliteEventLoop.stop();
}

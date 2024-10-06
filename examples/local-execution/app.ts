import pino from "pino";
import { createWorkflowInvoker } from "../../packages/@yieldstar/bun-workers-invokers/src";
import { createLocalSdk } from "yieldstar";
import { sqliteEventLoop, workflowRouter } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

export const invoker = createWorkflowInvoker({ workerPath, logger });
export const sdk = createLocalSdk(workflowRouter, invoker);

sqliteEventLoop.start({ onNewTask: invoker.execute });

try {
  const result = await sdk.triggerAndWait("simple-workflow");
  console.log(result);
} finally {
  sqliteEventLoop.stop();
}

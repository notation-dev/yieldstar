import pino from "pino";
import { createWorkflowManager } from "yieldstar-manager-bun-workers";
import { createLocalSdk } from "yieldstar";
import { sqliteEventLoop, workflowRouter } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

export const manager = createWorkflowManager({ workerPath, logger });
export const sdk = createLocalSdk(workflowRouter, manager);

sqliteEventLoop.start({ onNewTask: manager.execute });

try {
  const result = await sdk.triggerAndWait("simple-workflow");
  console.log(result);
} finally {
  sqliteEventLoop.stop();
}

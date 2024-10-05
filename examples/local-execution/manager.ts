import pino from "pino";
import { createWorkflowManager } from "yieldstar-server-bun";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

export const manager = createWorkflowManager({ workerPath, logger });

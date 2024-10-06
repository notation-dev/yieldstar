import pino from "pino";
import { createWorkflowHttpServer } from "yieldstar-server-bun-http";
import { createWorkflowManager } from "yieldstar-manager-bun-workers";
import { sqliteEventLoop } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

const manager = createWorkflowManager({
  workerPath,
  logger,
});

const server = createWorkflowHttpServer({
  port: 8080,
  logger,
  manager,
});

sqliteEventLoop.start({ onNewTask: manager.execute });
server.serve();

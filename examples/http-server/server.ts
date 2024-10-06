import pino from "pino";
import { createWorkflowHttpServer } from "yieldstar-server-bun-http";
import { createWorkflowInvoker } from "../../packages/yieldstar-invoker-bun-workers/src";
import { sqliteEventLoop } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

const invoker = createWorkflowInvoker({
  workerPath,
  logger,
});

const server = createWorkflowHttpServer({
  port: 8080,
  logger,
  invoker,
});

sqliteEventLoop.start({ onNewTask: invoker.execute });
server.serve();

import pino from "pino";
import { createWorkflowHttpServer } from "@yieldstar/bun-http-server";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
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
  responseHeaders: new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }),
});

sqliteEventLoop.start({ onNewEvent: invoker.execute, logger });
server.serve();

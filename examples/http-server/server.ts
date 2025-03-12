import pino from "pino";
import {
  createMiddleware,
  createWorkflowHttpServer,
} from "@yieldstar/bun-http-server";
import { createWorkflowInvoker } from "@yieldstar/bun-worker-invoker";
import { sqliteEventLoop } from "./shared";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

const invoker = createWorkflowInvoker({
  workerPath,
  logger,
});

const authMiddleware = createMiddleware(async (req, event, next) => {
  const token = req.headers.get("Authorization");
  if (!token) {
    return Response.json("Unauthorized", { status: 401 });
  }
  return next();
});

const corsMiddleware = createMiddleware(async (req, event, next) => {
  event.context.set("cors", "enabled");
  const response = await next();
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
});

const server = createWorkflowHttpServer({
  port: 8080,
  logger,
  invoker,
  middleware: [corsMiddleware, authMiddleware],
});

sqliteEventLoop.start({ onNewEvent: invoker.execute, logger });
server.serve();

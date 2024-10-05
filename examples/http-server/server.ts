import pino from "pino";
import {
  createWorkflowManager,
  createWorkflowHttpServer,
} from "yieldstar-bun-server";
import { sqliteEventLoop } from "./runtime";

const logger = pino();
const workerPath = new URL("worker.ts", import.meta.url).href;

const manager = createWorkflowManager({ workerPath, logger });
const server = createWorkflowHttpServer({ port: 8080, logger, manager });

sqliteEventLoop.start({ onNewTask: manager.execute });
server.serve();

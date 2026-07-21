import { expect, test } from "bun:test";
import { once } from "node:events";
import type { Logger } from "pino";
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";

const logger = { info() {}, error() {} } as unknown as Logger;
const fixtures = new URL("./fixtures/worker-invoker/", import.meta.url);

const executeAndWait = async (params: {
  fixture: string;
  executionId: string;
  context?: Map<string, unknown>;
  execPath?: string;
}) => {
  const { fixture, executionId, context = new Map(), execPath } = params;
  const invoker = createWorkflowInvoker({
    workerPath: new URL(fixture, fixtures).href,
    execPath,
    logger,
  });
  const result = once(invoker.workflowEndEmitter, executionId);

  await invoker.execute({ workflowId: "workflow", executionId, context });

  return result;
};

test("forks a worker and preserves its Map context", async () => {
  const result = await executeAndWait({
    fixture: "success.mjs",
    executionId: "worker-success",
    context: new Map([["requestId", "request"]]),
  });

  expect(result).toEqual([true]);
});

test("rejects when the worker process cannot spawn", async () => {
  const invoker = createWorkflowInvoker({
    workerPath: new URL("success.mjs", fixtures).href,
    execPath: "/missing/yieldstar-node",
    logger,
  });

  expect(
    invoker.execute({
      workflowId: "workflow",
      executionId: "worker-spawn-error",
      context: new Map(),
    })
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("emits nothing when a suspended workflow replies without a result", async () => {
  const executionId = "worker-suspend";
  const invoker = createWorkflowInvoker({
    workerPath: new URL("suspend.mjs", fixtures).href,
    logger,
  });
  const emissions: unknown[] = [];
  invoker.workflowEndEmitter.on(executionId, (result) => {
    emissions.push(result);
  });

  await invoker.execute({ workflowId: "workflow", executionId, context: new Map() });

  // Wait for the killed child to exit so a spurious exit-handler emission would surface
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(emissions).toEqual([]);
});

test("emits an error when the worker exits before replying", async () => {
  const [error] = await executeAndWait({
    fixture: "early-exit.mjs",
    executionId: "worker-early-exit",
  });

  expect((error as Error).message).toMatch(/exited before replying \(code 17\)/);
});

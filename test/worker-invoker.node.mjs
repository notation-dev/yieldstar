import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";

const logger = { info() {}, error() {} };
const fixtures = new URL("./fixtures/worker-invoker/", import.meta.url);

const executeAndWait = async ({ fixture, executionId, context = new Map() }) => {
  const invoker = createWorkflowInvoker({
    workerPath: new URL(fixture, fixtures).href,
    logger,
  });
  const result = once(invoker.workflowEndEmitter, executionId);

  await invoker.execute({ workflowId: "workflow", executionId, context });

  return result;
};

test("forks a worker and preserves its Map context", { timeout: 2_000 }, async () => {
  const result = await executeAndWait({
    fixture: "success.mjs",
    executionId: "worker-success",
    context: new Map([["requestId", "request"]]),
  });

  assert.deepEqual(result, [true]);
});

test("rejects when the worker process cannot spawn", { timeout: 2_000 }, async () => {
  const invoker = createWorkflowInvoker({
    workerPath: new URL("success.mjs", fixtures).href,
    execPath: "/missing/yieldstar-node",
    logger,
  });
  await assert.rejects(
    invoker.execute({
      workflowId: "workflow",
      executionId: "worker-spawn-error",
      context: new Map(),
    }),
    { code: "ENOENT" }
  );
});

test("emits nothing when a suspended workflow replies without a result", { timeout: 2_000 }, async () => {
  const executionId = "worker-suspend";
  const invoker = createWorkflowInvoker({
    workerPath: new URL("suspend.mjs", fixtures).href,
    logger,
  });
  const emissions = [];
  invoker.workflowEndEmitter.on(executionId, (result) => {
    emissions.push(result);
  });

  await invoker.execute({ workflowId: "workflow", executionId, context: new Map() });

  // Wait for the killed child to exit so a spurious exit-handler emission would surface
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(emissions, []);
});

test("emits an error when the worker exits before replying", { timeout: 2_000 }, async () => {
  const [error] = await executeAndWait({
    fixture: "early-exit.mjs",
    executionId: "worker-early-exit",
  });

  assert.match(error.message, /exited before replying \(code 17\)/);
});

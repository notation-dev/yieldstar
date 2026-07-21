import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { createWorkflowInvoker } from "@yieldstar/worker-invoker";

const logger = { info() {}, error() {} };
const fixtures = new URL("./fixtures/worker-invoker/", import.meta.url);

const which = (runtime) => {
  const result = spawnSync("which", [runtime], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
};

const executeAndWait = async ({ fixture, executionId, context = new Map(), execPath }) => {
  const invoker = createWorkflowInvoker({
    workerPath: new URL(fixture, fixtures).href,
    execPath,
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

// Bun does not speak Node's advanced IPC serialization protocol, so a Bun
// worker under a Node parent exits without ever receiving the event. This
// pins the failure mode: an emitted error rather than a hang.
test(
  "surfaces an error when forking a Bun worker (cross-runtime IPC unsupported)",
  { timeout: 2_000, skip: !which("bun") && "bun not found on PATH" },
  async () => {
    const [error] = await executeAndWait({
      fixture: "success.mjs",
      executionId: "worker-cross-runtime-bun",
      context: new Map([["requestId", "request"]]),
      execPath: which("bun"),
    });

    assert.match(error.message, /exited before replying/);
  }
);

test("emits an error when the worker exits before replying", { timeout: 2_000 }, async () => {
  const [error] = await executeAndWait({
    fixture: "early-exit.mjs",
    executionId: "worker-early-exit",
  });

  assert.match(error.message, /exited before replying \(code 17\)/);
});

import { expect, test } from "bun:test";
import { createWorkflow } from "yieldstar";
import { createWorkflowTestRunner } from "yieldstar-test-utils";

const runner = createWorkflowTestRunner();

test("poll retries when predicate fails", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        return false;
      });
    } catch {}
  });

  await runner.triggerAndWait(workflow);

  expect(runs).toBe(10);
});

test("poll resolves when predicate passes", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
      runs++;
      return true;
    });
  });

  await runner.triggerAndWait(workflow);

  expect(runs).toBe(1);
});

test("poll fails if a regular error is thrown", async () => {
  let runs: number = 0;

  const workflow = createWorkflow(async function* (step) {
    try {
      yield* step.poll({ retryInterval: 1, maxAttempts: 10 }, () => {
        runs++;
        throw new Error("Step error");
      });
    } catch {}
  });

  await runner.triggerAndWait(workflow);

  expect(runs).toBe(1);
});

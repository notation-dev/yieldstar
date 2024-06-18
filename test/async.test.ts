import { beforeEach, expect, test, mock } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-async.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
});

test("running sync workflows to completion", async () => {
  const mockWorkflowGenerator = mock(async function* (step: any) {
    let num = yield* step.run(() => {
      return 1;
    });

    num = yield* step.run(() => {
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const myWorkflow = createWorkflow(mockWorkflowGenerator);

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(mockWorkflowGenerator).toBeCalledTimes(1);
});

test("deferring workflow execution", async () => {
  const mockWorkflowGenerator = mock(async function* (step: any) {
    let num = yield* step.run(() => {
      return 1;
    });

    yield* step.delay(5);

    num = yield* step.run(() => {
      return Promise.resolve(num * 2);
    });

    return num;
  });

  const myWorkflow = createWorkflow(mockWorkflowGenerator);

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(mockWorkflowGenerator).toBeCalledTimes(2);
});

test("resumes workflow after a set delay", async () => {
  const myWorkflow = createWorkflow(async function* (step: any) {
    const firstExecutionTime = yield* step.run(() => {
      return Date.now();
    });

    yield* step.delay(10);

    const secondExecutionTime = yield* step.run(() => {
      return Date.now();
    });

    return { firstExecutionTime, secondExecutionTime };
  });

  const result = await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  const delay = result.secondExecutionTime - result.firstExecutionTime;

  expect(delay).toBeGreaterThanOrEqual(10);
  // allow 5ms margin of error
  expect(delay).toBeLessThanOrEqual(15);
});

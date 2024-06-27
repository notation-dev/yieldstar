import { beforeEach, expect, test, mock } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-persistence.sqlite");
const sqliteConnector = new SqliteConnector({ db });

beforeEach(() => {
  sqliteConnector.deleteAll();
});

test("step.run without cache keys", async () => {
  const mock1 = mock(() => 1);
  const mock2 = mock(() => 2);

  let executionIdx = -1;

  const myWorkflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run(mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run(mock2);
    }
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).not.toBeCalled();
});

test("step.run with cache keys", async () => {
  const mock1 = mock(() => 1);
  const mock2 = mock(() => 2);

  let executionIdx = -1;

  const myWorkflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx === 0) {
      yield* step.run("step 1", mock1);
      yield* step.delay(1);
    } else if (executionIdx === 1) {
      yield* step.run("step 2", mock2);
    }
  });

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(mock1).toBeCalledTimes(1);
  expect(mock2).toBeCalledTimes(1);
});

test("step.delay without cache keys", async () => {
  let executionIdx = -1;

  const myWorkflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay(10);
    } else {
      yield* step.delay(10);
    }
  });

  let startTime = Date.now();

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  let duration = Date.now() - startTime;

  // expect second delay to be a cache hit
  expect(duration).toBeGreaterThanOrEqual(10);
  expect(duration).toBeLessThan(15);
});

test("step.delay with cache keys", async () => {
  let executionIdx = -1;

  const myWorkflow = createWorkflow(async function* (step) {
    executionIdx++;
    if (executionIdx < 1) {
      yield* step.delay("step 1", 10);
    } else {
      yield* step.delay("step 2", 10);
    }
  });

  let startTime = Date.now();

  await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  let duration = Date.now() - startTime;

  // expect second delay to trigger a new timer
  expect(duration).toBeGreaterThanOrEqual(20);
  expect(duration).toBeLessThan(25);
});

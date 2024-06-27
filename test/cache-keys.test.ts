import { beforeEach, expect, test, mock } from "bun:test";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/test-cache-keys.sqlite");
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

test("interlacing cache keys and cache indexes", async () => {
  let executionIdx = -1;

  const myWorkflow = createWorkflow(async function* (step) {
    executionIdx++;
    let volatileNum = 0;
    let stableNum = 0;

    // a different step will run on re-invocation of the workflow
    // therefore the steps need cache keys
    if (executionIdx === 0) {
      stableNum = yield* step.run("step-1", () => 1);
      volatileNum = yield* step.run(() => 1);
    } else {
      volatileNum = yield* step.run(() => 2);
      stableNum = yield* step.run("step-2", () => 2);
    }

    // trigger a second invocation of the workflow
    yield* step.delay(100);

    return { stableNum, volatileNum };
  });

  const result = await runToCompletion({
    workflow: myWorkflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  expect(result.stableNum).toBe(2);
  expect(result.volatileNum).toBe(1);
});

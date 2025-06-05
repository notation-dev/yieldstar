import { beforeAll, afterAll, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import pino from "pino";
import { WorkflowRunner } from "@yieldstar/core";
import { createWorkflow } from "yieldstar";
import {
  PostgresEventLoop,
  PostgresHeapClient,
  PostgresSchedulerClient,
  PostgresTaskQueueClient,
  PostgresTimersClient,
} from "./index";
import { PostgresTaskQueue } from "./postgres-task-queue";
import { PostgresTimers } from "./postgres-timers";

const logger = pino({ level: "fatal" });
const sql = new SQL("postgres://testuser:testpass@localhost/yieldstar_test");

let heap: PostgresHeapClient;
let taskQueue: PostgresTaskQueue;
let taskQueueClient: PostgresTaskQueueClient;
let timers: PostgresTimers;
let timersClient: PostgresTimersClient;
let scheduler: PostgresSchedulerClient;
let eventLoop: PostgresEventLoop;

beforeAll(async () => {
  heap = new PostgresHeapClient(sql);
  taskQueue = new PostgresTaskQueue(sql);
  taskQueueClient = new PostgresTaskQueueClient(sql);
  timers = new PostgresTimers({ sql, taskQueue });
  timersClient = new PostgresTimersClient(sql);
  scheduler = new PostgresSchedulerClient({
    taskQueueClient,
    timersClient,
  });
  eventLoop = new PostgresEventLoop(sql);

  await sql`DELETE FROM step_responses`;
  await sql`DELETE FROM task_queue`;
  await sql`DELETE FROM scheduled_tasks`;
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM step_responses`;
  await sql`DELETE FROM task_queue`;
  await sql`DELETE FROM scheduled_tasks`;
});

test("heap client read/write", async () => {
  await heap.writeStep({
    executionId: "1",
    stepKey: "s1",
    stepAttempt: 0,
    stepDone: true,
    stepResponseJson: "\"ok\"",
  });

  const step = await heap.readStep({ executionId: "1", stepKey: "s1" });
  expect(step?.stepResponseJson).toBe("\"ok\"");
  expect((await heap.getAllSteps()).length).toBe(1);

  await heap.deleteAll();
  expect((await heap.getAllSteps()).length).toBe(0);
});

test("scheduler immediate vs delayed", async () => {
  await scheduler.requestWakeUp({
    workflowId: "wf",
    executionId: "immediate",
    context: new Map(),
  });

  await scheduler.requestWakeUp(
    { workflowId: "wf", executionId: "delayed", context: new Map() },
    5,
  );

  const immediate = await taskQueue.process();
  expect(immediate?.event.executionId).toBe("immediate");
  await Bun.sleep(10);
  await timers.processTimers();
  const delayed = await taskQueue.process();
  expect(delayed?.event.executionId).toBe("delayed");
});

test("task queue flow", async () => {
  await taskQueue.add({ workflowId: "wf", executionId: "e1" });
  await taskQueue.add({ workflowId: "wf", executionId: "e2" });

  const first = await taskQueue.process();
  expect(first?.event.executionId).toBe("e1");
  expect(await taskQueue.isEmpty()).toBe(false);

  if (first) {
    await taskQueue.remove(first.taskId);
  }

  const second = await taskQueue.process();
  expect(second?.event.executionId).toBe("e2");
  if (second) await taskQueue.remove(second.taskId);

  expect(await taskQueue.isEmpty()).toBe(true);
});

test("event loop processes timers", async () => {
  const workflow = createWorkflow(async function* (step) {
    yield* step.run(() => 1);
    yield* step.delay(5);
    yield* step.run(() => 2);
  });

  const runner = new WorkflowRunner({
    heapClient: heap,
    schedulerClient: scheduler,
    router: { wf: workflow },
    logger,
  });

  eventLoop.start({ onNewEvent: runner.run, logger });
  await taskQueueClient.add({ workflowId: "wf", executionId: "1" });
  await Bun.sleep(120);
  eventLoop.stop();
  await Bun.sleep(40);

  const steps = await heap.getAllSteps();
  expect(steps.length).toBeGreaterThanOrEqual(3);
});

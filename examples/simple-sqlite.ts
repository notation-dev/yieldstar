import { createWorkflow, WorkflowEngine } from "yieldstar";
import {
  SqliteScheduler,
  SqliteEventLoop,
  SqlitePersister,
  createSqliteDb,
} from "yieldstar-sqlite-bun";

const db = await createSqliteDb("./.db/example-workflows.sqlite");

const sqliteEventLoop = new SqliteEventLoop(db);

const sqliteScheduler = new SqliteScheduler({
  taskQueue: sqliteEventLoop.taskQueue,
  timers: sqliteEventLoop.timers,
});

const sqlitePersister = new SqlitePersister(db);

const workflow = createWorkflow(async function* (step) {
  let num = yield* step.run(() => {
    console.log("In step 1");
    return 1;
  });

  yield* step.delay(1000);

  num = yield* step.run(async () => {
    console.log("In step 2");
    return Promise.resolve(num * 2);
  });

  return num;
});

sqlitePersister.deleteAll();
sqliteEventLoop.start();

const engine = new WorkflowEngine({
  persister: sqlitePersister,
  scheduler: sqliteScheduler,
  waker: sqliteEventLoop.waker,
  router: { "workflow-1": workflow },
});

const result = await engine.triggerAndWait("workflow-1");
console.log(`\nWorkflow Result: ${result}\n`);

sqliteEventLoop.stop();

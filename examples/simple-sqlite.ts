import { createWorkflow, Executor } from "yieldstar";
import {
  SqliteScheduler,
  SqliteRuntime,
  SqlitePersister,
  createSqliteDb,
} from "yieldstar-sqlite-bun";

const db = await createSqliteDb("./.db/example-workflows.sqlite");

const sqliteRuntime = new SqliteRuntime(db);

const sqliteScheduler = new SqliteScheduler({
  taskQueue: sqliteRuntime.taskQueue,
  timers: sqliteRuntime.timers,
});

const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: sqliteScheduler,
  waker: sqliteRuntime.waker,
});

sqlitePersister.deleteAll();

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

sqliteRuntime.start();

const result = await executor.runAndAwaitResult(workflow);
console.log(`\nWorkflow Result: ${result}\n`);

sqliteRuntime.stop();

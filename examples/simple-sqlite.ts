import { createWorkflow, Executor } from "yieldstar";
import { LocalScheduler, LocalWaker, LocalRuntime } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const localWaker = new LocalWaker();
const localRuntime = new LocalRuntime(localWaker);

const localScheduler = new LocalScheduler({
  taskQueue: localRuntime.taskQueue,
  timers: localRuntime.timers,
});

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: localScheduler,
  waker: localWaker,
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

localRuntime.start();

const result = await executor.runAndAwaitResult(workflow);
console.log(`\nWorkflow Result: ${result}\n`);

localRuntime.stop();

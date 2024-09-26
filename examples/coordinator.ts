import type { StepRunner } from "yieldstar";
import { createWorkflow, Executor } from "yieldstar";
import { timeoutScheduler } from "yieldstar-local";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

const executor = new Executor({
  persister: sqlitePersister,
  scheduler: timeoutScheduler,
});

sqlitePersister.deleteAll();

type WorkflowFn<T> = (
  step: StepRunner,
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

const coordinator = async <T>(workflowFn: WorkflowFn<T>) => {
  const workflow = createWorkflow(async function* (step) {
    const waitForState = async function* (expectedState: string) {
      yield* step.poll({ maxAttempts: 10, retryInterval: 1000 }, () => {
        console.log("Polling...");
        return true;
      });
    };
    return yield* workflowFn(step, waitForState);
  });

  const result = await executor.runAndAwaitResult({
    workflow: workflow,
    executionId: "abc:123",
  });

  console.log(`\nWorkflow Result: ${result}\n`);
};

await coordinator(async function* (step, waitForState) {
  const a = yield* step.run(() => 2);
  yield* step.delay(1000);
  yield* waitForState("enabled");
  const b = yield* step.run(() => a * 3);
  return b;
});

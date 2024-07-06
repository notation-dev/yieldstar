import { sleep } from "bun";
import type { StepRunner } from "yieldstar";
import { createWorkflow, runToCompletion } from "yieldstar";
import { SqlitePersister } from "yieldstar-persister-sqlite-bun";

const db = await SqlitePersister.createDb("./.db/example-workflows.sqlite");
const sqlitePersister = new SqlitePersister({ db });

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

  const result = await runToCompletion({
    workflow: workflow,
    persister: sqlitePersister,
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

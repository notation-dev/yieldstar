import type { StepRunner } from "yieldstar";
import { createWorkflow, runToCompletion, RetryableError } from "yieldstar";
import { SqliteConnector } from "yieldstar-sqlite-bun";

const db = await SqliteConnector.createDb("./.db/workflows.sqlite");
const sqliteConnector = new SqliteConnector({ db });

sqliteConnector.deleteAll();

type WorkflowFn<T> = (
  step: StepRunner,
  waitForState: (s: string) => AsyncGenerator
) => AsyncGenerator<any, T>;

const coordinator = async <T>(workflowFn: WorkflowFn<T>) => {
  const workflow = createWorkflow(async function* (step) {
    const waitForState = async function* (expectedState: string) {
      yield* step.poll({ maxAttempts: 10, retryInterval: 10000 }, () => {
        console.log("Polling...");
        return false;
      });
    };
    return yield* workflowFn(step, waitForState);
  });

  const result = await runToCompletion({
    workflow: workflow,
    connector: sqliteConnector,
    executionId: "abc:123",
  });

  console.log(`\nWorkflow Result: ${result}\n`);
};

await coordinator(async function* (step, waitForState) {
  const a = yield* step.run(() => 1);
  yield* step.delay(10000);
  yield* waitForState("enabled");
  const b = yield* step.run(() => a * 3);
  return b;
});

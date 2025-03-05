import { createWorkflow } from "yieldstar";

const workflowPlan = [
  { type: "get-number" },
  { type: "delay", duration: 1000 },
  { type: "log" },
  { type: "fail" },
] as const;

export const dynamicWorkflow = createWorkflow(async function* (step, logger) {
  let lastResult: any;
  for (const action of workflowPlan) {
    switch (action.type) {
      case "get-number":
        lastResult = yield* step.run(() => Math.random());
        break;
      case "delay":
        yield* step.delay(action.duration);
        break;
      case "log":
        yield* step.run(() => {
          logger.info("Logging: ", lastResult);
        });
        break;
      case "fail":
        throw new Error("Workflow failure");
    }
  }
});

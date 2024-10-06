import { createWorkflow } from "yieldstar";

const workflowPlan = [
  { type: "get-number" },
  { type: "delay", duration: 1000 },
  { type: "log" },
] as const;

export const dynamicWorkflow = createWorkflow(async function* (step) {
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
          console.log("Logging: ", lastResult);
        });
    }
  }
});

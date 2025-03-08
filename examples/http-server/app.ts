import { createHttpSdkFactory } from "yieldstar";
import type { WorkflowRouter } from "./shared";

export const createSdk = createHttpSdkFactory<WorkflowRouter>();
const sdk = createSdk({ host: "localhost", port: 8080 });

try {
  const result = await sdk.triggerAndWait({
    workflowId: "dynamic-workflow",
    params: {
      msg: "world",
    },
  });
  console.log(result);
} catch (err) {
  console.error(err);
}

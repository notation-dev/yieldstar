import { createHttpSdkFactory } from "yieldstar";
import type { WorkflowRouter } from "./shared";

export const createSdk = createHttpSdkFactory<WorkflowRouter>();
const sdk = createSdk({ host: "localhost", port: 8080 });

try {
  const execution = await sdk.trigger({
    workflowId: "dynamic-workflow",
    params: {
      msg: "world!",
    },
  });

  console.log("triggered execution:", execution.executionId);

  const ack = await execution.ack();
  console.log("acknowledgement from workflow server:", ack);

  const res = await execution.waitForResult();
  console.log("result:", res);
} catch (err) {
  console.error(err);
}

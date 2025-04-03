import { createHttpSdkFactory } from "yieldstar";
import type { WorkflowRouter } from "./shared";

export const createSdk = createHttpSdkFactory<WorkflowRouter>();
const sdk = createSdk({ url: "http://localhost:8080" });

try {
  const execution = await sdk.trigger({
    workflowId: "simple-workflow",
    params: {
      msg: "world!",
    },
    context: {
      user: {
        id: "123",
        name: "John Doe",
      },
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

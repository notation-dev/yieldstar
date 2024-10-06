import { createHttpSdkFactory } from "yieldstar";
import { workflowRouter } from "./shared";

export const createSdk = createHttpSdkFactory(workflowRouter);
const sdk = createSdk({ host: "localhost", port: 8080 });

const result = await sdk.triggerAndWait("dynamic-workflow");

console.log(result);

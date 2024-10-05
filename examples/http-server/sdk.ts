import { createHttpSdkFactory } from "yieldstar";
import { workflowRouter } from "./router";

export const createSdk = createHttpSdkFactory(workflowRouter);

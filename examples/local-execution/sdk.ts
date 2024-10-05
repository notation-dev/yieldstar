import { createLocalSdk } from "yieldstar";
import { workflowRouter } from "./router";
import { manager } from "./manager";

export const sdk = createLocalSdk(workflowRouter, manager);

import { createWorkflowRouter } from "yieldstar";
import { simpleWorkflow } from "../workflows/simple";
import { pollingWorkflow } from "../workflows/polling";

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
  polling: pollingWorkflow,
});

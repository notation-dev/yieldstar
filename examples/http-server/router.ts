import { createWorkflowRouter } from "yieldstar";
import { simpleWorkflow } from "../workflows/simple";

export const workflowRouter = createWorkflowRouter({
  "simple-workflow": simpleWorkflow,
});

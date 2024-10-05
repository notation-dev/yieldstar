import type { WorkflowRouter } from "../types";

export function createWorkflowRouter<W extends WorkflowRouter>(
  workflows: W
): W {
  return workflows;
}

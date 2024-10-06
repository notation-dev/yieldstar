import type { WorkflowRouter } from "@yieldstar/core";

export function createWorkflowRouter<W extends WorkflowRouter>(
  workflows: W
): W {
  return workflows;
}

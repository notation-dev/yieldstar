export type Task = { workflowId: string; executionId: string; params?: any };

export type TaskProcessor = <T = any>(task: Task) => Promise<void | T>;

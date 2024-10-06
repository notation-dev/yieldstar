import type { Logger } from "pino";
import type { Task, WorkflowManager } from "yieldstar";

export function createWorkflowHttpServer(params: {
  port: number;
  manager: WorkflowManager;
  logger: Logger;
}) {
  const { logger, port, manager } = params;
  return {
    serve() {
      return Bun.serve({
        port: port,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/events") {
            const { executionId } = (await req.json()) as {
              executionId: string;
            };

            if (!executionId) {
              return new Response("Missing executionId", { status: 400 });
            }

            try {
              const result = await new Promise((resolve) => {
                manager.workflowEndEmitter.once(executionId, resolve);
              });
              return Response.json(result);
            } catch (err: any) {
              logger.error(err);
              return new Response("Workflow failure", { status: 500 });
            }
          }

          if (url.pathname === "/trigger") {
            try {
              const task = (await req.json()) as Task;
              await manager.execute(task);
              return Response.json(
                { executionId: task.executionId },
                { status: 202 }
              );
            } catch (error) {
              logger.error(error);
              return new Response("Invalid JSON", { status: 400 });
            }
          }

          return new Response("Not Found", { status: 404 });
        },
      });
    },
  };
}

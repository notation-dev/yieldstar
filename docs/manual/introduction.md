# Introduction

Yieldstar is a workflow engine that provides a du rable runtime for JavaScript generator functions.

The state of a generator workflow is stored to a pluggable backend such as a Sqlite file or a Postgres database. There is no requirement to use any particular cloud platform. 

Workflows are checkpointed by `yield* step()` calls, which he runtime persists, caches, retries, and resumes across process restarts.

```ts
import { workflow } from "yieldstar";

const checkout = workflow(async function* (step) {
  const order = yield* step.run(() => createOrder());
  yield* step.delay(30_000);
  const payment = yield* step.run(() => chargeCard(order.id));
  return yield* step.run(() => confirmOrder(order.id, payment.id));
});
```


## How it compares

|                       | **Yieldstar**                   | **Temporal**            | **Inngest**            | **Cloudflare Workflows**    |
| --------------------- | ------------------------------- | ----------------------- | ---------------------- | --------------------------- |
| **State persistence** | SQLite file (local) or Postgres | Temporal Server cluster | Inngest Cloud (SaaS)   | Cloudflare Durable Objects  |
| **Infrastructure**    | Process plus a file             | Multi-service cluster   | SaaS platform          | Cloudflare Workers platform |
| **Self-hostable**     | Yes, single process             | Yes, but complex        | No                     | No                          |
| **Embeddable**        | Yes                             | No                      | No                     | No                          |
| **Portability**       | Runs anywhere JS runs           | Needs Temporal Server   | Needs Inngest platform | Needs Cloudflare            |
| **Deployment safety** | Out-of-order step detection     | Manual versioning       | Manual versioning      | Manual versioning           |

## Execution model

The execution model works by replaying the generator. When a step completes, the runtime snapshots its return value to a persistent heap and either advances to the next step or yields control back to the orchestrator. When the orchestrator later resumes the workflow, the runtime feeds each previously completed step its stored result instead of re-executing it, so the generator picks up exactly where it stopped.

This differs from `await step.run()` engines such as Inngest and Cloudflare Workflows, which intercept Promises through platform-specific wrappers. 

Yieldstar uses `yield*`, JavaScript's native generator delegation, as a bi-directional protocol between the workflow and the runtime. 

## Packages

Yieldstar is a monorepo of composable packages:

| Package                         | Role                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `yieldstar`                     | Core SDK with `workflow`, `createWorkflowRouter`, `RetryableError`, and the local and HTTP SDKs |
| `@yieldstar/core`               | Base types and the `WorkflowRunner` execution engine                                 |
| `@yieldstar/sqlite-runtime` | Driver-agnostic SQLite heap, scheduler, task queue, timers, and event loop           |
| `@yieldstar/bun-worker-invoker` | Bun subprocess invoker and worker process                                            |
| `@yieldstar/bun-http-server`    | HTTP routes and middleware for triggering workflows over the network                 |

The runtime splits into four subsystems. 

- A **heap** stores step results so they survive restarts. 
- A **scheduler** tracks timers and wake-ups. 
- A **task queue** orders pending work. 
- An **event loop** polls the queue and dispatches executions.

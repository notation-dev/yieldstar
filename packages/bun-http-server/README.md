# @yieldstar/bun-http-server

## Features

- Route handlers for triggering and monitoring workflows
- Middleware for request/response/context processing

## Installation

```sh
npm install @yieldstar/bun-http-server
```

## Basic Usage

```ts
import { createRoutes } from "@yieldstar/bun-http-server";
import { pino } from "pino";

const logger = pino();

const server = Bun.serve({
  port: 3000,
  routes: createRoutes({
    invoker: invoker,
    logger: logger,
    middleware: [middleware1, middleware2],
  }),
});

logger.info(`Server started on port ${server.url}`);
```

## Custom Routes

```ts
Bun.serve({
  port: 3000,
  routes: {
    "status": new Reponse('OK')
      // mount workflow routes on /workflow
    ...createRoutes({
      basePath: "/workflow",
      invoker: invoker,
      logger: logger,
    }),
  }
});
```

## Middleware

Middleware can be passed to the server. Middleware enables:

- reading the HTTP request
- setting context (available to other middleware and the invoked workflow)
- returning early HTTP responses
- setting HTTP reponse headers

```ts
import {
  createWorkflowHttpServer,
  createMiddleware,
} from "@yieldstar/bun-http-server";

// CORS middleware
const corsMiddleware = createMiddleware(async (req, event, next) => {
  // Continue to the next middleware or handler
  const response = await next();

  // Add CORS headers to the response
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  return response;
});

// Authentication middleware
const authMiddleware = createMiddleware(async (req, event, next) => {
  // Get auth token from request
  const cookies = parseCookies(req.headers.get("Cookie"));
  const authToken = cookies["X-Token"];

  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Store the auth token in the context
  event.context.set("authToken", authToken);

  // Continue to the next middleware or handler
  return next();
});

// Create server with middleware
const server = createWorkflowHttpServer({
  port: 8080,
  logger,
  invoker,
  middleware: [corsMiddleware, authMiddleware],
});
```

### Middleware lifecycle

```ts
import { createMiddleware } from "@yieldstar/bun-http-server";

const myMiddleware = createMiddleware(async (req, event, next) => {
  // Read the HTTP request
  const token = req.headers.get("X-token");

  // Read context set by previous middlewares
  event.context.get("token");

  // Set context
  if (!token) {
    event.context.set("token", token);
  }

  // Advance the middleware chain until either:
  // A middleware function returns a response,
  // or, the final handler invokes the workflow
  const response = await next();

  // After next() is called, the context is frozen to prevent modifications
  // Any attempt to modify the context will throw an error:
  event.context.set("key", "value"); // Error: Cannot call set on a frozen map

  // When passed to the workflow, the context is converted to a read-only version
  // that prevents modifications in the workflow

  // The response can still be updated before it is sent to the user
  response.headers.set("X-Handled-By", "SuperAceDev");

  return response;
});
```

## API Reference

### `createRoutes(options)`

Creates an HTTP server for YieldStar workflows.

Options:

- `invoker`: The workflow invoker
- `logger`: A Pino logger instance
- `middleware`: Optional array of middleware functions
- `basePath`: Optional path to mount the routes on

### `createMiddleware(handler)`

Creates a middleware function.

Handler parameters:

- `req`: The request object
- `event`: The middleware event with a context property (Map)
- `next`: Function to call the next middleware or handler
- `logger`: The logger passed to createRoutes

## License

MIT

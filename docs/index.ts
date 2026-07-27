import type { DocCategory } from "@notation/docs/config";

export const categories: DocCategory[] = [
  {
    label: "User Manual",
    slug: "manual",
    sections: [
      {
        heading: "Getting Started",
        icon: "rocket",
        links: [
          { label: "Introduction", slug: "manual/introduction" },
          { label: "Installation", slug: "manual/installation" },
          { label: "Quick Start", slug: "manual/quickstart" },
          { label: "Migrate 0.4 to 0.5", slug: "migrations/0.4-to-0.5" },
        ],
      },
      {
        heading: "Workflows",
        icon: "cpu",
        links: [
          { label: "Defining Workflows", slug: "manual/workflows" },
          { label: "Steps", slug: "manual/steps" },
          { label: "Retries", slug: "manual/retries" },
        ],
      },
      {
        heading: "State",
        icon: "database",
        links: [
          { label: "Durable Stores", slug: "manual/stores" },
          { label: "Waiting on State", slug: "manual/store-waiting" },
          { label: "External Store Access", slug: "manual/store-external" },
        ],
      },
      {
        heading: "Interfaces",
        icon: "terminal",
        links: [
          { label: "Local SDK", slug: "manual/sdk-local" },
          { label: "HTTP SDK", slug: "manual/sdk-http" },
          { label: "HTTP Server", slug: "manual/http-server" },
        ],
      },
    ],
  },
  {
    label: "Runtimes",
    slug: "runtimes",
    sections: [
      {
        heading: "Runtime families",
        icon: "cpu",
        links: [
          { label: "Runtime Matrix", slug: "runtimes/index" },
          { label: "Resident Process", slug: "runtimes/resident-process" },
        ],
      },
      {
        heading: "SQLite connectors",
        icon: "database",
        links: [
          { label: "Bun", slug: "runtimes/resident-process-bun" },
          { label: "Node", slug: "runtimes/resident-process-node" },
        ],
      },
    ],
  },
  {
    label: "Packages",
    slug: "packages",
    sections: [
      {
        heading: "Reference",
        icon: "terminal",
        links: [
          { label: "yieldstar", slug: "packages/yieldstar" },
          { label: "@yieldstar/core", slug: "packages/core" },
          { label: "http-server", slug: "packages/http-server" },
          { label: "sqlite-runtime", slug: "packages/sqlite-runtime" },
          { label: "worker-invoker", slug: "packages/worker-invoker" },
        ],
      },
    ],
  },
];

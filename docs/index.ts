import type { DocCategory } from "../../../packages/templates/docs";

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
        heading: "Workers",
        icon: "layers",
        links: [
          { label: "Local (SQLite)", slug: "manual/local-runtime" },
          { label: "HTTP Server", slug: "manual/http-server" },
        ],
      },
      {
        heading: "Triggering",
        icon: "terminal",
        links: [
          { label: "Local SDK", slug: "manual/sdk-local" },
          { label: "HTTP SDK", slug: "manual/sdk-http" },
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
          { label: "bun-http-server", slug: "packages/bun-http-server" },
          { label: "bun-sqlite-runtime", slug: "packages/bun-sqlite-runtime" },
          { label: "bun-worker-invoker", slug: "packages/bun-worker-invoker" },
        ],
      },
    ],
  },
];

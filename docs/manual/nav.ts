import type { DocCategory } from "@notation/docs/config";

export const manual: DocCategory = {
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
};

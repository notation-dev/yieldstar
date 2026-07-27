import type { DocCategory } from "@notation/docs/config";

export const runtimes: DocCategory = {
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
};

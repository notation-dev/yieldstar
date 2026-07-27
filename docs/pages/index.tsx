import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@notation/docs/ui";
import { Hero } from "#/views/landing/hero";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="h-dvh flex flex-col">
      <SiteHeader />
      <Hero />
    </div>
  ),
});

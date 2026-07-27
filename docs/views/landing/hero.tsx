import { Button } from "@notation/docs/ui/element";
import { GitHub } from "@notation/docs/ui/icon";
import { Section } from "@notation/docs/ui/layout";
import { Heading, Text } from "@notation/docs/ui/element";
import { Link } from "@tanstack/react-router";
import { Example } from "./example";

export const Hero = () => (
  <Section className="flex-1">
    <div className="bleed-full">
      <div className="page-wrap py-8 md:py-10">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 lg:items-start">
          <div className="max-w-3xl">
            <Heading as="h1" variant="largeTitle" className="mb-6">
              Native workflows. <br />
              Durable execution.
            </Heading>
            <div className="space-y-3 lg:space-y-5 opacity-70">
              <Text>
                Yieldstar is a durable workflow engine for JavaScript generator functions.
              </Text>
              <Text>Run it locally with SQLite, or on Postgres with distributed workers.</Text>
              <Text>Local-first, self-hosted and open source.</Text>
            </div>
            <div className="flex gap-4 mt-9">
              <Button
                as="a"
                href="https://github.com/notationlabs/yieldstar"
                variant="default"
                size="sm"
              >
                <GitHub className="-ml-1 sm:-ml-2.5 w-5 h-5" />
                Github
              </Button>
              <Button as={Link} to="/docs" variant="outline" size="sm">
                Docs →
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <Example />
          </div>
        </div>
      </div>
    </div>
  </Section>
);

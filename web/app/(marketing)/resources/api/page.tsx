import type { Metadata } from "next";

import { CodeTabs } from "@/components/marketing/resources/code-tabs";
import { PageHero } from "@/components/marketing/resources/page-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Body,
  Card,
  CardGrid,
  MediaCard,
  Section,
  SectionHead,
  Title,
} from "@/components/site/sections";

const DESCRIPTION =
  "One platform, four surfaces: the marketer.sh REST API, Python SDK, CLI, and MCP server. Authenticate with personal access tokens and let agents enqueue real work.";

export const metadata: Metadata = {
  title: "API, SDK, CLI & MCP — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "API, SDK, CLI & MCP — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources/api" },
};

const PAT_POINTS = [
  {
    title: "Created in Settings",
    copy: "Generate tokens from Settings → Access tokens. Each starts with mkt_ and is shown exactly once, so store it in a secret manager, not a repo.",
  },
  {
    title: "Hashed at rest",
    copy: "We store a hash, never the token. If a token leaks, revoke it in one click; every surface using it stops working immediately.",
  },
  {
    title: "Bounded by your caps",
    copy: "A token can never outspend you. Every call it makes runs through the same per-niche and global daily caps as the dashboard, and fails closed at the limit.",
  },
];

export default function ApiPage() {
  return (
    <main>
      <PageHero
        headline="One platform. Four surfaces."
        highlight="Four surfaces."
        kicker="Developers"
        sub="Everything the dashboard does is callable: REST for anything, a Python SDK for scripts, a CLI for the terminal, and an MCP server for agents."
      />

      {/* Surfaces */}
      <Section label="Developer surfaces">
        <SectionHead
          eyebrow="Pick a surface"
          heading="The same platform, however you call it."
          highlight="however you call it."
          lede="All four surfaces share one API, one token format, and one set of spend rules. Start where you are comfortable and switch anytime."
        />
        <div className="os-mt-48">
          <CodeTabs />
        </div>
        <div className="os-mt-24">
          <MediaCard
            kind="illustration"
            label="Agent surfaces — API, SDK, CLI, MCP map"
            ratio="16/8"
          />
        </div>
      </Section>

      {/* PAT auth */}
      <Section label="Authentication">
        <SectionHead
          eyebrow="Authentication"
          heading="Tokens you can hand to an agent."
          highlight="hand to an agent."
          lede="Personal access tokens authenticate every surface. They are designed to be given away, to a script, a CI job, or an autonomous agent, without giving away your account."
        />
        <CardGrid className="os-mt-48">
          {PAT_POINTS.map((point) => (
            <Card key={point.title}>
              <Title size="sm">{point.title}</Title>
              <Body className="os-mt-8">{point.copy}</Body>
            </Card>
          ))}
        </CardGrid>
        <p className="os-body os-mt-32">
          <code className="os-code">Authorization: Bearer mkt_…</code> works
          identically on the API, SDK, CLI, and MCP server.
        </p>
      </Section>

      <SectionCta
        headline="Point an agent at it today."
        kicker="Build"
        primaryHref="/sign-up"
        primaryLabel="Create a token"
        secondaryHref="/resources/guides/agent-driven-marketing"
        secondaryLabel="Agent setup guide"
        sub="Sign up, mint a token in Settings, and your agent can enqueue its first article in the next five minutes."
      />
    </main>
  );
}

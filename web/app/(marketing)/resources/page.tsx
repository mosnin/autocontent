import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { ResourceCard } from "@/components/marketing/resources/resource-card";
import { StageMedia } from "@/components/marketing/features/stage-media";
import { SectionCta } from "@/components/marketing/system";
import { CardGrid, Section } from "@/components/site/sections";

const DESCRIPTION =
  "Docs, guides, and references for marketer.sh: the quickstart, the API, SDK, CLI and MCP surfaces, launch guides, the changelog, and answers to common questions.";

export const metadata: Metadata = {
  title: "Resources — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Resources — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources" },
};

const CARDS = [
  {
    category: "Start here",
    title: "Quickstart",
    description:
      "From sign-up to a running channel in six steps. One sentence in, first video approved, autopilot on.",
    href: "/resources/quickstart",
    scene: "sky",
    vignette: <StageMedia kind="image" label="Quickstart still" />,
  },
  {
    category: "Developers",
    title: "API, SDK, CLI & MCP",
    description:
      "Four surfaces, one platform. Enqueue work over REST, script it in Python, drive it from a terminal, or hand it to an agent.",
    href: "/resources/api",
    scene: "dusk",
    vignette: <StageMedia kind="image" label="CLI session still" />,
  },
  {
    category: "Guide",
    title: "Launch your first channel in an afternoon",
    description:
      "Framing a niche, writing the one-sentence brief, choosing a voice, and earning trust with approval mode.",
    href: "/resources/guides/first-channel",
    scene: "pearl",
    vignette: <StageMedia kind="image" label="First-channel guide still" />,
  },
  {
    category: "Guide",
    title: "Rank with articles your agents write",
    description:
      "How the article pipeline researches, outlines, and writes, and how to set up internal links and cadence per niche.",
    href: "/resources/guides/seo-articles",
    scene: "mist",
    vignette: <StageMedia kind="image" label="SEO guide still" />,
  },
  {
    category: "Guide",
    title: "Hand your marketing to an agent, safely",
    description:
      "MCP setup, token scopes, spend caps as guardrails, and how to widen autonomy once the output earns it.",
    href: "/resources/guides/agent-driven-marketing",
    scene: "dawn",
    vignette: <StageMedia kind="image" label="MCP guide still" />,
  },
  {
    category: "Product",
    title: "Changelog",
    description:
      "What shipped and when. New pipelines, guardrails, and agent surfaces, newest first.",
    href: "/resources/changelog",
    scene: "warm",
    vignette: <StageMedia kind="image" label="Changelog still" />,
  },
  {
    category: "Support",
    title: "FAQ",
    description:
      "Caps, approvals, platforms, ownership, refunds, and data handling, answered plainly.",
    href: "/resources/faq",
    scene: "sky",
    vignette: <StageMedia kind="image" label="FAQ still" />,
  },
] as const;

export default function ResourcesPage() {
  return (
    <main>
      <PageHero
        headline="Learn it. Script it. Ship it."
        highlight="Ship it."
        kicker="Resources"
        size="xl"
        sub="Everything you need to run marketer.sh well, whether you drive it from the dashboard, the terminal, or an agent."
      />

      <Section label="Browse resources">
        <CardGrid>
          {CARDS.map((card) => (
            <ResourceCard key={card.href} {...card} />
          ))}
        </CardGrid>
      </Section>

      <SectionCta
        headline="Read less. Ship more."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/resources/quickstart"
        secondaryLabel="Open the quickstart"
        sub="The quickstart takes about twenty minutes end to end, and the first thing it produces is a real video."
      />
    </main>
  );
}

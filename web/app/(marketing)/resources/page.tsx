import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { ResourceCard } from "@/components/marketing/resources/resource-card";
import { StageMedia } from "@/components/marketing/features/stage-media";
import { SectionCta } from "@/components/marketing/system";
import { CardGrid, Section } from "@/components/site/sections";

const DESCRIPTION =
  "Guides, docs, the API, and answers for marketer.sh. Start with the quickstart, then pick the job you want.";

export const metadata: Metadata = {
  title: "Resources · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Resources · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources" },
};

const CARDS = [
  {
    category: "Guides",
    title: "Prepare, create, and review",
    description:
      "Browse guides to briefing, budgets, editorial review, and repeatable production.",
    href: "/resources/guides",
    scene: "sky",
    vignette: <StageMedia kind="image" label="Content production guide" />,
  },
  {
    category: "Help",
    title: "Find the next step",
    description:
      "Setup, credit questions, connected workflows, and what to check when a job stops.",
    href: "/resources/help",
    scene: "warm",
    vignette: <StageMedia kind="image" label="Publishing help" />,
  },
  {
    category: "Start here",
    title: "Quickstart",
    description:
      "Set up a brief, check costs, and review your first piece of content.",
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
    title: "Set up your first content channel",
    description:
      "Choose an audience, prepare a brief, and keep the first run in review.",
    href: "/resources/guides/first-channel",
    scene: "pearl",
    vignette: <StageMedia kind="image" label="First-channel guide still" />,
  },
  {
    category: "Guide",
    title: "Create an article that answers a real question",
    description:
      "How the article pipeline researches, outlines, and writes, and how to set up internal links and cadence per channel.",
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

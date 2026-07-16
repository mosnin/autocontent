import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { ResourceCard } from "@/components/marketing/resources/resource-card";
import {
  ChangelogMiniVignette,
  FaqMiniVignette,
} from "@/components/marketing/resources/resource-vignettes";
import { SectionCta, Stagger } from "@/components/marketing/system";
import {
  AgentChatVignette,
  ArticleSeoVignette,
  MCPVignette,
  ScheduleVignette,
  TerminalVignette,
} from "@/components/marketing/vignettes";

const DESCRIPTION =
  "Docs, guides, and references for marketer.sh: the quickstart, the API, SDK, CLI and MCP surfaces, launch guides, the changelog, and answers to common questions.";

export const metadata: Metadata = {
  title: "Resources | marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Resources | marketer.sh",
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
    vignette: <ScheduleVignette />,
  },
  {
    category: "Developers",
    title: "API, SDK, CLI & MCP",
    description:
      "Four surfaces, one platform. Enqueue work over REST, script it in Python, drive it from a terminal, or hand it to an agent.",
    href: "/resources/api",
    scene: "dusk",
    vignette: <TerminalVignette />,
  },
  {
    category: "Guide",
    title: "Launch your first channel in an afternoon",
    description:
      "Framing a niche, writing the one-sentence brief, choosing a voice, and earning trust with approval mode.",
    href: "/resources/guides/first-channel",
    scene: "pearl",
    vignette: <AgentChatVignette />,
  },
  {
    category: "Guide",
    title: "Rank with articles your agents write",
    description:
      "How the article pipeline researches, outlines, and writes, and how to set up internal links and cadence per niche.",
    href: "/resources/guides/seo-articles",
    scene: "mist",
    vignette: <ArticleSeoVignette />,
  },
  {
    category: "Guide",
    title: "Hand your marketing to an agent, safely",
    description:
      "MCP setup, token scopes, spend caps as guardrails, and how to widen autonomy once the output earns it.",
    href: "/resources/guides/agent-driven-marketing",
    scene: "dawn",
    vignette: <MCPVignette />,
  },
  {
    category: "Product",
    title: "Changelog",
    description:
      "What shipped and when. New pipelines, guardrails, and agent surfaces, newest first.",
    href: "/resources/changelog",
    scene: "warm",
    vignette: <ChangelogMiniVignette />,
  },
  {
    category: "Support",
    title: "FAQ",
    description:
      "Caps, approvals, platforms, ownership, refunds, and data handling, answered plainly.",
    href: "/resources/faq",
    scene: "sky",
    vignette: <FaqMiniVignette />,
  },
] as const;

export default function ResourcesPage() {
  return (
    <main>
      <PageHero
        headline="Learn it. Script it. Ship it."
        kicker="Resources"
        size="xl"
        sub="Everything you need to run marketer.sh well, whether you drive it from the dashboard, the terminal, or an agent."
      />

      <section aria-label="Browse resources" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <Stagger
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          gap={0.08}
          itemClassName="h-full"
        >
          {CARDS.map((card) => (
            <ResourceCard key={card.href} {...card} />
          ))}
        </Stagger>
      </section>

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

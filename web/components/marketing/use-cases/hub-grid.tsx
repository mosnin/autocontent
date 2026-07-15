import * as React from "react";

import {
  Stagger,
  VignetteCard,
  type VignetteScene,
} from "@/components/marketing/system";
import {
  AgentChatVignette,
  ArticleSeoVignette,
  CapGaugeVignette,
  MetricsVignette,
  QueueVignette,
  ScheduleVignette,
} from "@/components/marketing/vignettes";

/** Quiet "See how" arrow row pinned to the card bottom. */
function SeeHow() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900">
      See how
      <svg
        aria-hidden
        className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The six cards                                                       */
/* ------------------------------------------------------------------ */

const CASES: Array<{
  href: string;
  title: string;
  promise: string;
  scene: VignetteScene;
  vignette: React.ReactNode;
}> = [
  {
    href: "/use-cases/creators",
    title: "Creators",
    promise: "Daily shorts without the editing days.",
    scene: "dusk",
    vignette: <QueueVignette />,
  },
  {
    href: "/use-cases/ecommerce",
    title: "Ecommerce",
    promise: "Every product line becomes a content engine.",
    scene: "warm",
    vignette: <ArticleSeoVignette />,
  },
  {
    href: "/use-cases/saas",
    title: "SaaS",
    promise: "Shorts that teach, articles that convert.",
    scene: "sky",
    vignette: <MetricsVignette />,
  },
  {
    href: "/use-cases/agencies",
    title: "Agencies",
    promise: "Every client on its own budget and gate.",
    scene: "pearl",
    vignette: <CapGaugeVignette />,
  },
  {
    href: "/use-cases/local-business",
    title: "Local business",
    promise: "Show up every week without a marketing hire.",
    scene: "dawn",
    vignette: <ScheduleVignette />,
  },
  {
    href: "/use-cases/ai-agents",
    title: "AI agents",
    promise: "Your agents are the marketing team.",
    scene: "mist",
    vignette: <AgentChatVignette />,
  },
];

/**
 * The hub's six cards, one per audience: a product vignette staged on
 * that audience's scene wash, the audience name, and its one-line
 * promise (Amendment 2 card language — no decorative icons).
 */
export function HubGrid() {
  return (
    <section
      aria-label="Use cases"
      className="mx-auto max-w-6xl px-6 py-16 md:py-24"
    >
      <Stagger
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        gap={0.08}
        itemClassName="h-full"
      >
        {CASES.map((c) => (
          <VignetteCard
            description={c.promise}
            footer={<SeeHow />}
            href={c.href}
            key={c.href}
            scene={c.scene}
            title={c.title}
            vignette={c.vignette}
          />
        ))}
      </Stagger>
    </section>
  );
}

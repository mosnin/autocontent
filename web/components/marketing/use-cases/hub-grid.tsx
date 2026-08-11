import * as React from "react";

import { VignetteCard, type VignetteScene } from "@/components/marketing/system";
import { CardGrid, CardLink, Section } from "@/components/site/sections";
import { StageMedia } from "@/components/marketing/features/stage-media";

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
    vignette: (
      <StageMedia kind="image" label="Creators workflow — screenshot" />
    ),
  },
  {
    href: "/use-cases/ecommerce",
    title: "Ecommerce",
    promise: "Every product line becomes a content engine.",
    scene: "warm",
    vignette: (
      <StageMedia kind="image" label="Ecommerce workflow — screenshot" />
    ),
  },
  {
    href: "/use-cases/saas",
    title: "SaaS",
    promise: "Shorts that teach, articles that convert.",
    scene: "sky",
    vignette: <StageMedia kind="image" label="SaaS workflow — screenshot" />,
  },
  {
    href: "/use-cases/agencies",
    title: "Agencies",
    promise: "Every client on its own budget and gate.",
    scene: "pearl",
    vignette: (
      <StageMedia kind="image" label="Agencies workflow — screenshot" />
    ),
  },
  {
    href: "/use-cases/local-business",
    title: "Local business",
    promise: "Show up every week without a marketing hire.",
    scene: "dawn",
    vignette: (
      <StageMedia kind="image" label="Local business workflow — screenshot" />
    ),
  },
  {
    href: "/use-cases/ai-agents",
    title: "AI agents",
    promise: "Your agents are the marketing team.",
    scene: "mist",
    vignette: (
      <StageMedia kind="image" label="AI agents workflow — screenshot" />
    ),
  },
];

/**
 * The hub's six cards, one per audience: a product vignette staged on
 * that audience's scene wash, the audience name, and its one-line
 * promise (Amendment 2 card language — no decorative icons).
 */
export function HubGrid() {
  return (
    <Section label="Use cases">
      <CardGrid>
        {CASES.map((c) => (
          <VignetteCard
            description={c.promise}
            footer={<CardLink>See how</CardLink>}
            href={c.href}
            key={c.href}
            scene={c.scene}
            title={c.title}
            vignette={c.vignette}
          />
        ))}
      </CardGrid>
    </Section>
  );
}

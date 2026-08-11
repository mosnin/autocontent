import * as React from "react";

import {
  Body,
  Card,
  Section,
  SectionHead,
  Title,
} from "@/components/site/sections";

export type FaqItem = { q: string; a: string };

/**
 * Small FAQ band (used on /use-cases/ai-agents only). The page that renders
 * it also embeds the matching FAQPage JSON-LD.
 */
export function FaqBand({ items }: { items: FaqItem[] }) {
  return (
    <Section label="Frequently asked questions">
      <SectionHead
        align="center"
        eyebrow="Questions"
        heading="Agents, answered."
        highlight="answered."
        size="md"
      />
      <div className="os-bordered os-divide-y os-mt-48">
        {items.map((item) => (
          <div className="os-qa" key={item.q}>
            <Title size="sm">{item.q}</Title>
            <Body className="os-mt-8">{item.a}</Body>
          </div>
        ))}
      </div>
    </Section>
  );
}

import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { PricingTiles } from "@/components/marketing/resources/pricing-tiles";
import { SectionCta } from "@/components/marketing/system";
import {
  Actions,
  Body,
  Btn,
  Card,
  CardGrid,
  Eyebrow,
  Frame,
  MediaCard,
  Section,
  SectionHead,
  Title,
} from "@/components/site/sections";

const DESCRIPTION =
  "Prepaid credit packs from $5, no subscription. Every video and article is metered against your balance, and hard daily caps make overruns impossible by design.";

export const metadata: Metadata = {
  title: "Pricing — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Pricing — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/pricing" },
};

const HOW_IT_WORKS = [
  {
    title: "Credit is prepaid",
    copy: "Buy a pack once through Stripe and it becomes your balance. No subscription, no seats, no renewal date. Credits don't expire.",
  },
  {
    title: "Every render is metered",
    copy: "Each video and article draws down your balance at provider cost plus a flat margin. You see the estimate before a job runs and the exact cost after.",
  },
  {
    title: "Caps stop overruns",
    copy: "Per-niche daily budgets plus a global cap, checked before every job. Work that would cross a cap is refused, not billed. The system fails closed.",
  },
];

const MINI_FAQ = [
  {
    q: "Do credits expire?",
    a: "No. Your balance sits until you use it. Buy $5 in January, render in June.",
  },
  {
    q: "What does one video cost?",
    a: "It depends on length, style, and voice; the Starter pack's $5 renders roughly 8 to 12 videos. Articles cost less. Every job shows its estimate before it runs.",
  },
  {
    q: "Is anything gated by pack?",
    a: "No. Every feature, including the API, SDK, CLI, and MCP server, works on every pack. Packs differ only in how much credit you load.",
  },
  {
    q: "What if I want out?",
    a: "Stop buying packs; there is nothing to cancel. If you have unused balance, contact support and we refund the remainder of your last purchase.",
  },
];

export default function PricingPage() {
  return (
    <main>
      <PageHero
        headline="Pay for what ships. Nothing else."
        highlight="Nothing else."
        kicker="Pricing"
        size="xl"
        sub="Three prepaid credit packs. Every render metered, every dollar capped, no subscription anywhere."
      />

      {/* Packs */}
      <Section label="Credit packs" size="tight">
        <PricingTiles />
        <Body className="os-mt-32 os-center">
          One-time purchases through Stripe. Top up whenever, in any mix.
        </Body>
      </Section>

      {/* How credits work */}
      <Section label="How credits work">
        <SectionHead
          eyebrow="How credits work"
          heading="A balance, a meter, and a hard limit."
          highlight="a hard limit."
          lede="The billing model is three moving parts, and all three are visible on your dashboard at all times."
        />
        <div className="os-mt-48">
          <MediaCard
            kind="illustration"
            label="How credits work — diagram"
            ratio="16/8"
          />
        </div>
        <CardGrid className="os-mt-24">
          {HOW_IT_WORKS.map((item, i) => (
            <Card key={item.title}>
              <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
              <Title className="os-mt-12" size="sm">
                {item.title}
              </Title>
              <Body className="os-mt-8">{item.copy}</Body>
            </Card>
          ))}
        </CardGrid>
      </Section>

      {/* Mini FAQ + agents & teams */}
      <Section label="Pricing questions">
        <SectionHead
          eyebrow="Common questions"
          heading="The fine print, unfined."
          highlight="unfined."
        />
        <CardGrid className="os-mt-48" cols={2}>
          {MINI_FAQ.map((item) => (
            <Card key={item.q}>
              <Title size="sm">{item.q}</Title>
              <Body className="os-mt-8">{item.a}</Body>
            </Card>
          ))}
        </CardGrid>

        <Frame className="os-mt-24">
          <div className="os-teams">
            <div>
              <Eyebrow>Agents &amp; teams</Eyebrow>
              <Title className="os-mt-20" level={3}>
                Running many niches, or a fleet of agents?
              </Title>
              <Body className="os-mt-12 os-measure">
                The Studio pack covers most of it: per-niche caps, API and MCP
                access, several channels in parallel. If your setup is bigger or
                stranger than that, talk to us and we&apos;ll make it work.
              </Body>
            </div>
            <Actions>
              <Btn href="mailto:hello@marketer.sh">hello@marketer.sh</Btn>
              <Btn href="/resources/api" variant="secondary">
                See the agent surfaces
              </Btn>
            </Actions>
          </div>
        </Frame>
      </Section>

      <SectionCta
        headline="Five dollars says it works."
        highlight="Five dollars"
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/resources/faq"
        secondaryLabel="Read the FAQ"
        sub="The Starter pack renders roughly 8 to 12 videos with every feature on. Nothing publishes until you approve it."
      />
    </main>
  );
}

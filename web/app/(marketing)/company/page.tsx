import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Card,
  CardGrid,
  MediaSlot,
  Section,
  SectionHead,
  Stage,
  Title,
} from "@/components/site/sections";

const DESCRIPTION =
  "Why marketer.sh exists: marketing should compound while you build. We make autonomous pipelines that ship daily, spend honestly, and always leave the veto with you.";

export const metadata: Metadata = {
  title: "Company — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Company — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/company" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "marketer.sh",
  url: "https://marketer.sh",
  description: DESCRIPTION,
  sameAs: [],
};

const PRINCIPLES = [
  {
    title: "Ship daily",
    copy: "Consistency beats brilliance in distribution. The system's first duty is to show up every day, on schedule, in every format, without being reminded.",
  },
  {
    title: "Spend honestly",
    copy: "Every render is metered, every dollar is logged, and a cap is a promise: work that would cross it is refused, not billed. No surprise invoices, ever.",
  },
  {
    title: "Human veto",
    copy: "Autonomy is earned, not assumed. Publishing waits behind approval gates until you widen them, and every gate closes again in one click.",
  },
  {
    title: "Agents as teammates",
    copy: "Software should be callable by the software you already trust. API, SDK, CLI, and MCP are first-class doors, with the same rules behind each one.",
  },
];

export default function CompanyPage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <PageHero
        headline="Marketing should compound, not consume you."
        highlight="not consume you."
        kicker="Company"
        size="xl"
        sub="We build the marketing department that runs itself, so the people with something worth selling can go back to making it."
        variant="mist"
      />

      {/* The why */}
      <Section label="Why marketer.sh exists">
        <div className="os-essay">
          <SectionHead
            eyebrow="The problem"
            heading="The treadmill taxes the wrong people."
            highlight="the wrong people."
            size="md"
          />
          <p className="os-guide__p os-mt-20">
            Distribution now demands a daily video, a steady article cadence,
            and a feel for three different feeds. The people best positioned to
            make something worth distributing, builders, founders, makers, are
            exactly the people who can least afford to spend four hours a day
            feeding the machine. So most don&apos;t. The work stays good and
            unknown.
          </p>

          <blockquote className="os-quote os-mt-48">
            The best marketing team is a system that shows up every day and
            tells you exactly what it spent.
          </blockquote>

          <div className="os-mt-64">
            <SectionHead
              eyebrow="The bet"
              heading="Pipelines, not heroics."
              highlight="not heroics."
              size="md"
            />
            <p className="os-guide__p os-mt-20">
              Frontier models made each step of marketing automatable: the
              script, the frames, the voice, the article, the metadata. What was
              missing was the system around the steps, the thing that ideates
              from performance, renders on schedule, publishes into posting
              windows, and learns from what happened. That system is what we
              build. One brief in, every format out, better every week.
            </p>
          </div>

          <div className="os-mt-64">
            <SectionHead
              eyebrow="The line we hold"
              heading="Autonomous, never unaccountable."
              highlight="never unaccountable."
              size="md"
            />
            <p className="os-guide__p os-mt-20">
              An autonomous system spending your money and speaking in your name
              has to be governable, or it is a liability with a nice demo. That
              is why caps fail closed, why approval gates exist, why every
              action lands in an audit log, and why the kill switch is one
              click. We would rather lose a benchmark than your trust.
            </p>
          </div>
        </div>
      </Section>

      {/* Team */}
      <Section label="The team" size="tight">
        <CardGrid>
          {["Team photo", "Team photo", "Team photo"].map((label, i) => (
            <Stage key={i}>
              <MediaSlot className="os-aspect-45" kind="image" label={label} />
            </Stage>
          ))}
        </CardGrid>
      </Section>

      {/* Principles */}
      <Section label="Principles">
        <SectionHead
          eyebrow="Principles"
          heading="Four rules we build by."
          highlight="Four rules"
        />
        <CardGrid className="os-mt-48" cols={2}>
          {PRINCIPLES.map((principle, i) => (
            <Card key={principle.title} padding="lg">
              <span className="os-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Title className="os-mt-12" level={3}>
                {principle.title}
              </Title>
              <p className="os-body os-mt-12">{principle.copy}</p>
            </Card>
          ))}
        </CardGrid>
      </Section>

      <SectionCta
        headline="Build with us."
        kicker="Join in"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/resources"
        secondaryLabel="Browse resources"
        sub="The fastest way to understand what we're making is to hand it a channel and watch it work."
      />
    </main>
  );
}

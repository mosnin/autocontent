import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import {
  DisplayHeading,
  GradientScene,
  Kicker,
  Reveal,
  SectionCta,
  Stagger,
} from "@/components/marketing/system";

const DESCRIPTION =
  "Why marketer.sh exists: marketing should compound while you build. We make autonomous pipelines that ship daily, spend honestly, and always leave the veto with you.";

export const metadata: Metadata = {
  title: "Company | marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Company | marketer.sh",
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
        kicker="Company"
        size="xl"
        sub="We build the marketing department that runs itself, so the people with something worth selling can go back to making it."
        variant="mist"
      />

      {/* The why */}
      <section
        aria-label="Why marketer.sh exists"
        className="mx-auto max-w-3xl px-6 py-24 md:py-32"
      >
        <Reveal>
          <Kicker>The problem</Kicker>
          <DisplayHeading className="mt-4" size="md">
            The treadmill taxes the wrong people.
          </DisplayHeading>
          <p className="mt-5 text-[17px] leading-[1.75] text-zinc-600">
            Distribution now demands a daily video, a steady article cadence,
            and a feel for three different feeds. The people best positioned
            to make something worth distributing, builders, founders, makers,
            are exactly the people who can least afford to spend four hours a
            day feeding the machine. So most don&apos;t. The work stays good
            and unknown.
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="py-14 md:py-16">
            <blockquote className="border-l-2 border-brand/60 pl-6 md:pl-8">
              <p className="font-display text-2xl font-semibold leading-snug tracking-tight text-zinc-900 md:text-3xl">
                The best marketing team is a system that shows up every day
                and tells you exactly what it spent.
              </p>
            </blockquote>
          </div>
        </Reveal>

        <Reveal>
          <Kicker>The bet</Kicker>
          <DisplayHeading className="mt-4" size="md">
            Pipelines, not heroics.
          </DisplayHeading>
          <p className="mt-5 text-[17px] leading-[1.75] text-zinc-600">
            Frontier models made each step of marketing automatable: the
            script, the frames, the voice, the article, the metadata. What was
            missing was the system around the steps, the thing that ideates
            from performance, renders on schedule, publishes into posting
            windows, and learns from what happened. That system is what we
            build. One brief in, every format out, better every week.
          </p>
        </Reveal>

        <Reveal>
          <div className="mt-14 md:mt-16">
            <Kicker>The line we hold</Kicker>
            <DisplayHeading className="mt-4" size="md">
              Autonomous, never unaccountable.
            </DisplayHeading>
            <p className="mt-5 text-[17px] leading-[1.75] text-zinc-600">
              An autonomous system spending your money and speaking in your
              name has to be governable, or it is a liability with a nice
              demo. That is why caps fail closed, why approval gates exist,
              why every action lands in an audit log, and why the kill switch
              is one click. We would rather lose a benchmark than your trust.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Principles */}
      <section aria-label="Principles" className="px-4 py-6 md:px-6">
        <GradientScene
          className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
          variant="pearl"
        >
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
            <Reveal className="max-w-2xl">
              <Kicker>Principles</Kicker>
              <DisplayHeading className="mt-4">
                Four rules we build by.
              </DisplayHeading>
            </Reveal>
            <Stagger
              className="mt-14 grid gap-4 sm:grid-cols-2"
              gap={0.08}
              itemClassName="h-full"
            >
              {PRINCIPLES.map((principle, i) => (
                <div
                  className="h-full rounded-[1.5rem] border border-white/60 bg-white/70 p-8 shadow-[0_8px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
                  key={principle.title}
                >
                  <span className="font-mono text-xs tabular-nums text-zinc-400">
                    0{i + 1}
                  </span>
                  <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                    {principle.title}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-600">
                    {principle.copy}
                  </p>
                </div>
              ))}
            </Stagger>
          </div>
        </GradientScene>
      </section>

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

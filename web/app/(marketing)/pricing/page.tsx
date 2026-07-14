import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { PricingTiles } from "@/components/marketing/resources/pricing-tiles";
import {
  DisplayHeading,
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  SectionCta,
  Stagger,
} from "@/components/marketing/system";

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
        kicker="Pricing"
        size="xl"
        sub="Three prepaid credit packs. Every render metered, every dollar capped, no subscription anywhere."
      />

      {/* Packs */}
      <section
        aria-label="Credit packs"
        className="mx-auto max-w-6xl px-6 pb-24 pt-20 md:pb-32 lg:pt-24"
      >
        <PricingTiles />
        <Reveal className="mt-8 text-center lg:mt-6" delay={0.2}>
          <p className="text-sm text-zinc-500">
            One-time purchases through Stripe. Top up whenever, in any mix.
          </p>
        </Reveal>
      </section>

      {/* How credits work */}
      <section aria-label="How credits work" className="px-4 py-6 md:px-6">
        <GradientScene
          className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
          variant="sky"
        >
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
            <Reveal className="max-w-2xl">
              <Kicker>How credits work</Kicker>
              <DisplayHeading className="mt-4">
                A balance, a meter, and a hard limit.
              </DisplayHeading>
              <Lede className="mt-5">
                The billing model is three moving parts, and all three are
                visible on your dashboard at all times.
              </Lede>
            </Reveal>
            <Stagger
              className="mt-14 grid gap-4 md:grid-cols-3"
              gap={0.08}
              itemClassName="h-full"
            >
              {HOW_IT_WORKS.map((item, i) => (
                <div
                  className="h-full rounded-[1.5rem] border border-white/60 bg-white/70 p-7 shadow-[0_8px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
                  key={item.title}
                >
                  <span className="font-mono text-xs tabular-nums text-zinc-400">
                    0{i + 1}
                  </span>
                  <h3 className="mt-3 font-display text-lg font-semibold tracking-tight text-zinc-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
                    {item.copy}
                  </p>
                </div>
              ))}
            </Stagger>
          </div>
        </GradientScene>
      </section>

      {/* Mini FAQ + agents & teams */}
      <section
        aria-label="Pricing questions"
        className="mx-auto max-w-6xl px-6 py-24 md:py-32"
      >
        <Reveal className="max-w-2xl">
          <Kicker>Common questions</Kicker>
          <DisplayHeading className="mt-4">
            The fine print, unfined.
          </DisplayHeading>
        </Reveal>
        <Stagger className="mt-12 grid gap-4 sm:grid-cols-2" gap={0.08} itemClassName="h-full">
          {MINI_FAQ.map((item) => (
            <div
              className="h-full rounded-[1.5rem] border border-zinc-900/[0.06] bg-white p-7 shadow-[0_8px_40px_rgba(15,23,42,0.05)]"
              key={item.q}
            >
              <h3 className="font-display text-lg font-semibold tracking-tight text-zinc-900">
                {item.q}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
                {item.a}
              </p>
            </div>
          ))}
        </Stagger>

        <Reveal className="mt-6" delay={0.1}>
          <GlassPanel className="p-8 md:p-10" tone="dark">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Agents &amp; teams
                </p>
                <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-white md:text-2xl">
                  Running many niches, or a fleet of agents?
                </h3>
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-400">
                  The Studio pack covers most of it: per-niche caps, API and
                  MCP access, several channels in parallel. If your setup is
                  bigger or stranger than that, talk to us and we&apos;ll make
                  it work.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <a
                  className="inline-flex min-h-11 items-center rounded-full bg-white px-6 py-1.5 text-sm font-medium text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  href="mailto:hello@marketer.sh"
                >
                  hello@marketer.sh
                </a>
                <Link
                  className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-6 py-1.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  href="/resources/api"
                >
                  See the agent surfaces
                </Link>
              </div>
            </div>
          </GlassPanel>
        </Reveal>
      </section>

      <SectionCta
        headline="Five dollars says it works."
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

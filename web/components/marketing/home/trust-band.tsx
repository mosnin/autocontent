"use client";

import * as React from "react";
import Link from "next/link";

import { SpendGuardIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
} from "@/components/marketing/system";

const RULES = [
  {
    title: "Approval gates",
    copy: "Review every draft, approve by channel, or let a channel run free once you trust it.",
  },
  {
    title: "Hard spend caps",
    copy: "Per-channel daily budgets. A call that would pass the cap is refused, not billed.",
  },
  {
    title: "Full audit trail",
    copy: "Every render, post, and dollar is logged. Pause everything with one switch.",
  },
];

/** Trust and control: autonomy inside rules you set. */
export function TrustBand() {
  return (
    <section aria-label="Spend controls and approvals" className="px-4 py-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="mist"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="order-2 lg:order-1" delay={0.1}>
            <div className="rounded-[2rem] border border-white/60 bg-white/70 p-6 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-8">
              <SpendGuardIllustration />
            </div>
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <Kicker>Trust and control</Kicker>
            <DisplayHeading className="mt-4">
              Nothing posts without your rules.
            </DisplayHeading>
            <Lede className="mt-5">
              Autonomy is only useful because you hold the leash. You set the
              budget, the schedule, and the approval gates. The system works
              inside them.
            </Lede>
            <dl className="mt-9 space-y-6">
              {RULES.map((r) => (
                <div key={r.title}>
                  <dt className="font-display text-lg font-semibold tracking-tight text-zinc-900">
                    {r.title}
                  </dt>
                  <dd className="mt-1 max-w-md text-[15px] leading-relaxed text-zinc-600">
                    {r.copy}
                  </dd>
                </div>
              ))}
            </dl>
            <Link
              className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900 transition-colors hover:text-zinc-600"
              href="/features/analytics"
            >
              How spend controls work
              <svg
                aria-hidden
                className="size-3.5"
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
            </Link>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

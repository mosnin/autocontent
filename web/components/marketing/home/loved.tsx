"use client";

import * as React from "react";

import { Marquee, Reveal, TextReveal } from "@/components/marketing/system";

/**
 * Trust rail. No invented customers, no placeholder portraits: every card
 * is a first-party guarantee the product actually enforces, with the place
 * you can verify it. Real customer stories can join later — as themselves.
 */
const CARDS = [
  {
    claim: "Every dollar is metered.",
    detail:
      "Each render draws down prepaid credit call by call, and every video carries a receipt — estimate and actual, side by side.",
    where: "Verify: Billing → history, or any video's Costs tab",
  },
  {
    claim: "Nothing posts without you.",
    detail:
      "Channels start in review-before-post. Videos wait in the Review Room until you approve — or reject, recorded as your decision.",
    where: "Verify: the Review Room on any rendered video",
  },
  {
    claim: "The spend guard fails closed.",
    detail:
      "A run your balance or caps can't cover is refused before it starts — at the button, with the reason in plain words.",
    where: "Verify: try to run past your cap",
  },
  {
    claim: "Every action leaves a trail.",
    detail:
      "Admin actions and every ad-spend decision land in append-only audit logs — who, what, when, and why it was allowed or denied.",
    where: "Verify: Ads → Activity",
  },
];

export function Loved() {
  return (
    <section aria-label="Guarantees" className="bg-[#f5f6f8] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <TextReveal className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
            Built to be trusted.
          </TextReveal>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600">
            An autonomous system spending your money owes you proof, not
            promises. These aren&apos;t testimonials — they&apos;re guarantees
            you can check in the product.
          </p>
        </Reveal>

        <div
          className="mt-14"
          style={{
            maskImage:
              "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
          }}
        >
          <Marquee ariaLabel="Product guarantees" pauseOnHover seconds={40}>
            {CARDS.map((c) => (
              <figure
                className="mx-2.5 flex w-80 shrink-0 flex-col overflow-hidden rounded-3xl border border-zinc-900/[0.06] bg-white p-6 shadow-[0_8px_32px_rgba(15,23,42,0.06)]"
                key={c.claim}
              >
                <blockquote className="font-display text-xl font-semibold tracking-tight text-zinc-900">
                  {c.claim}
                </blockquote>
                <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-zinc-700">
                  {c.detail}
                </p>
                <figcaption className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                  {c.where}
                </figcaption>
              </figure>
            ))}
          </Marquee>
        </div>
      </div>
    </section>
  );
}

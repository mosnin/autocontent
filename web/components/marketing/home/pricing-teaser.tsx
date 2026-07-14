"use client";

import * as React from "react";

import { PACKS } from "@/components/marketing/pricing-data";
import {
  CtaPill,
  DisplayHeading,
  GlassPanel,
  Kicker,
  Lede,
  Reveal,
  Stagger,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/** Pricing teaser: the three prepaid packs, pointing at /pricing. */
export function PricingTeaser() {
  return (
    <section aria-label="Pricing" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <Kicker>Pricing</Kicker>
        <DisplayHeading className="mt-4">
          No subscription. Pay for what ships.
        </DisplayHeading>
        <Lede className="mt-5">
          Buy credit once. Every video and article draws it down at provider
          cost plus a flat margin, and the spend guard refuses calls your
          balance can&apos;t cover.
        </Lede>
      </Reveal>

      <Stagger className="mt-14 grid gap-4 sm:grid-cols-3" gap={0.08} itemClassName="h-full">
        {PACKS.map((p) => (
          <GlassPanel
            className={cn(
              "flex h-full flex-col p-7",
              p.featured && "border-zinc-900/15 ring-1 ring-zinc-900/10",
            )}
            key={p.label}
          >
            {p.featured ? (
              <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/20 bg-brand/[0.07] px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                <span className="size-1.5 rounded-full bg-brand" />
                Most popular
              </span>
            ) : null}
            <Kicker>{p.label}</Kicker>
            <p className="mt-3 font-display text-4xl font-semibold tabular-nums tracking-tight text-zinc-900">
              ${p.amount}
            </p>
            <p className="mt-1 text-sm text-zinc-500">{p.blurb}</p>
            <ul className="mt-6 space-y-2.5">
              {p.points.map((pt) => (
                <li className="flex items-center gap-2.5 text-sm text-zinc-600" key={pt}>
                  <svg
                    aria-hidden
                    className="size-3.5 shrink-0 text-zinc-900"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                  {pt}
                </li>
              ))}
            </ul>
          </GlassPanel>
        ))}
      </Stagger>

      <Reveal className="mt-10 flex justify-center" delay={0.15}>
        <CtaPill href="/pricing" variant="secondary">
          See full pricing
        </CtaPill>
      </Reveal>
    </section>
  );
}

import * as React from "react";

import { PACKS } from "@/components/marketing/pricing-data";
import {
  CtaPill,
  GlassPanel,
  Kicker,
  Stagger,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * The three prepaid packs from pricing-data.ts as full pricing tiles.
 * The featured pack sits elevated with a "Most popular" chip.
 */
export function PricingTiles() {
  return (
    <Stagger
      className="grid items-stretch gap-4 sm:grid-cols-3"
      gap={0.08}
      itemClassName="h-full"
    >
      {PACKS.map((pack) => (
        <GlassPanel
          className={cn(
            "relative flex h-full flex-col p-8",
            pack.featured &&
              "border-zinc-900/15 shadow-[0_16px_60px_rgba(15,23,42,0.14)] ring-1 ring-zinc-900/10 lg:-translate-y-3",
          )}
          key={pack.label}
        >
          {pack.featured ? (
            <span className="absolute -top-3 left-8 inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 shadow-[0_2px_12px_rgba(15,23,42,0.10)]">
              <span className="size-1.5 rounded-full bg-brand" />
              Most popular
            </span>
          ) : null}
          <Kicker>{pack.label}</Kicker>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-5xl font-semibold tabular-nums tracking-tight text-zinc-900">
              ${pack.amount}
            </span>
            <span className="text-sm text-zinc-500">once</span>
          </p>
          <p className="mt-1.5 text-[15px] text-zinc-500">{pack.blurb}</p>
          <ul className="mt-7 space-y-3">
            {pack.points.map((point) => (
              <li
                className="flex items-center gap-2.5 text-[15px] text-zinc-600"
                key={point}
              >
                <svg
                  aria-hidden
                  className="size-4 shrink-0 text-zinc-900"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path d="m5 13 4 4L19 7" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-8">
            <CtaPill
              className="w-full justify-center"
              href="/sign-up"
              variant={pack.featured ? "primary" : "secondary"}
            >
              Buy ${pack.amount} of credit
            </CtaPill>
          </div>
        </GlassPanel>
      ))}
    </Stagger>
  );
}

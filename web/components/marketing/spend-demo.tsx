"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { ElasticSlider } from "@/components/elastic-slider";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Interactive spend-cap demo. The daily ceiling is the product's core
 * guardrail, so we let visitors feel it: drag the cap, watch throughput.
 *
 * Throughput is a deliberately conservative back-of-envelope estimate —
 * a fully finished short (keyframes + motion + voice + captions + mix)
 * lands around this once amortized across a niche. Labeled "est." so it
 * reads as a sketch, not a quote.
 */
const COST_PER_VIDEO = 0.4;

const MIN_CAP = 1;
const MAX_CAP = 50;
const DEFAULT_CAP = 12;

export function SpendDemo() {
  const [cap, setCap] = useState(DEFAULT_CAP);

  const perDay = Math.floor(cap / COST_PER_VIDEO);
  const perMonth = perDay * 30;

  return (
    <section
      className="mx-auto w-full max-w-6xl px-6 py-24"
      id="spend-cap"
    >
      <div className="grid items-center gap-16 lg:grid-cols-2">
        <div>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              Your budget, enforced
            </p>
            <h2 className="mt-3 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Set the ceiling. The machine runs under it — or not at all.
            </h2>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
              No surprise invoices, no runaway loops. Pick a daily cap and the
              pipeline plans its output to fit — more headroom buys more videos,
              a tighter budget simply slows the cadence.
            </p>

            <div className="mt-8 flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-4">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10">
                <ShieldCheck className="size-4 text-brand" />
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The cap is checked{" "}
                <span className="font-medium text-foreground">
                  before every API call
                </span>
                . A job that would breach the ceiling is refused mid-flight —
                not explained afterward.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.15}>
          <div className="rounded-2xl border border-border/60 bg-card/40 p-8">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Estimated output
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                ${COST_PER_VIDEO.toFixed(2)}/video · est.
              </span>
            </div>

            <div className="mt-4 flex items-end gap-2.5">
              <span className="font-mono text-6xl font-semibold leading-none tabular-nums text-brand">
                {perDay}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                videos / day
              </span>
            </div>
            <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
              ≈ {perMonth.toLocaleString()} / month
            </p>

            <ElasticSlider
              aria-label="Daily spend cap in US dollars"
              className="mt-8"
              label="Daily cap"
              max={MAX_CAP}
              min={MIN_CAP}
              onValueChange={setCap}
              step={1}
              value={cap}
              formatValue={(v) => `$${v}`}
            />
            <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>${MIN_CAP}/day</span>
              <span>${MAX_CAP}/day</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

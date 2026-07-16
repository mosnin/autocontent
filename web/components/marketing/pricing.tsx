"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight, Check } from "lucide-react";

import { Power } from "@/components/marketing/power";
import { Reveal } from "@/components/marketing/reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Route A pricing: prepaid credits, not subscriptions. The honest pitch —
 * you pay for what the machine actually renders, the spend guard refuses
 * calls your balance can't cover, and self-hosting stays free forever.
 */
const PACKS = [
  {
    label: "Starter",
    amount: 5,
    blurb: "Try the machine",
    points: ["≈ 8-12 videos", "Every feature included", "No subscription"],
  },
  {
    label: "Creator",
    amount: 20,
    blurb: "A daily channel",
    points: ["≈ 35-50 videos", "Closed-loop optimization", "Review-before-post"],
    featured: true,
  },
  {
    label: "Studio",
    amount: 50,
    blurb: "Several niches at once",
    points: ["≈ 90-125 videos", "Per-niche spend caps", "API + MCP access"],
  },
];

export function Pricing() {
  return (
    <section className="border-y border-border/60 bg-card/20" id="pricing">
      <div className="mx-auto w-full max-w-6xl px-6 py-24">
        <Reveal>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Pricing
          </p>
          <h2 className="mt-3 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            No subscription. You pay for <Power>what ships</Power>.
          </h2>
          <p className="mt-3 max-w-lg text-sm text-muted-foreground">
            Buy credit once; every video draws it down at provider cost plus a
            flat infrastructure margin. The spend guard refuses any call your
            balance can&apos;t cover. You can never owe us money.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {PACKS.map((p, i) => (
            <Reveal delay={i * 0.08} key={p.label}>
              <div
                className={cn(
                  "flex h-full flex-col rounded-xl border p-6",
                  p.featured
                    ? "border-brand/50 bg-brand/5"
                    : "border-border/60 bg-card/40",
                )}
              >
                {p.featured && (
                  <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
                    <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                    Most popular
                  </span>
                )}
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {p.label}
                </p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums">
                  ${p.amount}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
                <ul className="mt-5 space-y-2">
                  {p.points.map((pt) => (
                    <li
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                      key={pt}
                    >
                      <Check aria-hidden className="size-3.5 text-brand" />
                      {pt}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex-1" />
                <SignedIn>
                  <Button asChild variant={p.featured ? "default" : "outline"}>
                    <Link href="/settings/billing">
                      Add credit
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </SignedIn>
                <SignedOut>
                  <Button asChild variant={p.featured ? "default" : "outline"}>
                    <Link href="/sign-in">
                      Start a channel
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </SignedOut>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Video estimates assume default niche settings (~$0.40-$0.55 per
            video, margin included). Self-hosting on your own API keys is free
            forever:{" "}
            <a
              className="text-brand hover:underline"
              href="https://github.com/mosnin/autocontent"
              rel="noreferrer"
              target="_blank"
            >
              read the source
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}

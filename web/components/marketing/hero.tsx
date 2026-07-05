"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";

import { DotGridSpotlight } from "@/components/dot-grid-spotlight";
import { PipelineCircuit } from "@/components/marketing/pipeline-circuit";
import { Power } from "@/components/marketing/power";
import { ShimmeringText } from "@/components/shimmering-text";
import { TextFlip } from "@/components/text-flip";
import { Button } from "@/components/ui/button";

const REPO_URL = "https://github.com/mosnin/autocontent";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Interactive dot field — reacts to the cursor, whispers "machine". */}
      <DotGridSpotlight
        activeDotColor="hsl(var(--brand) / 0.6)"
        className="absolute inset-0 -z-20"
        dotColor="hsl(var(--muted-foreground) / 0.14)"
        interactionRadius={180}
        spacing={26}
      />
      {/* Single directional glow. One light source, like a stage. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] opacity-70"
        style={{
          background:
            "radial-gradient(52% 42% at 50% 0%, hsl(var(--brand) / 0.14), transparent 70%)",
        }}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-8 pt-24 text-center sm:pt-32">
        <Link
          className="group mb-8 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 py-1 pl-1 pr-3 text-xs text-muted-foreground backdrop-blur transition-colors hover:border-brand/40 hover:text-foreground"
          href="/dashboard"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2 py-0.5 font-medium text-brand"><span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />
            New
          </span>
          Closed-loop optimization is live — every video tunes the next one
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </Link>

        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
          The <Power>content machine</Power>
          <br />
          that{" "}
          <ShimmeringText
            className="[--shimmering-color:hsl(var(--brand))]"
            duration={1.4}
            text="ships itself"
          />
        </h1>

        <div className="mt-8 flex max-w-2xl flex-col items-center gap-1 text-lg text-muted-foreground">
          <p className="text-balance">
            Describe a channel once. autocontent ideates, writes, animates,
            voices, mixes, and posts every day to
          </p>
          <TextFlip
            className="h-7 text-lg font-medium text-foreground"
            interval={2.2}
          >
            {["TikTok", "Instagram Reels", "YouTube Shorts"]}
          </TextFlip>
          <p className="text-balance">
            — under a spend cap you set, tuned by the numbers it earns.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <SignedIn>
            <Button asChild size="xl">
              <Link href="/dashboard">
                Open your dashboard
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </SignedIn>
          <SignedOut>
            <Button asChild size="xl">
              <Link href="/sign-in">
                Start a channel
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </SignedOut>
          <Button asChild size="xl" variant="outline">
            <a href={REPO_URL} rel="noreferrer" target="_blank">
              Read the source
            </a>
          </Button>
        </div>
      </div>

      {/* The product diagram IS the hero art. */}
      <div className="mx-auto w-full max-w-6xl px-6 pb-20">
        <PipelineCircuit />
        <p className="mt-2 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
          One niche in — daily videos out. Analytics close the loop.
        </p>
      </div>
    </section>
  );
}

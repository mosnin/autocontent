"use client";

import * as React from "react";

import { Power } from "@/components/marketing/power";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Show the product. Three vertical output videos in phone frames.
 *
 * Sources are read from /showcase/demo-{1..3}.mp4 (web/public/showcase/).
 * Any file that fails to load removes its frame; if none load, the whole
 * section unmounts — so the page is honest in every deployment: it shows
 * real output when real output is installed and nothing when it isn't.
 */
const SOURCES = ["/showcase/demo-1.mp4", "/showcase/demo-2.mp4", "/showcase/demo-3.mp4"];

export function Showcase() {
  const [alive, setAlive] = React.useState<string[]>(SOURCES);

  if (alive.length === 0) return null;

  return (
    <section className="border-y border-border/60 bg-card/20">
      <div className="mx-auto w-full max-w-6xl px-6 py-24">
        <Reveal>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            The output
          </p>
          <h2 className="mt-3 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Don&apos;t take our word for it. <Power>Watch what it makes</Power>.
          </h2>
          <p className="mt-3 max-w-lg text-sm text-muted-foreground">
            Every one of these was ideated, written, animated, voiced, mixed,
            and captioned by the machine — no human in the loop.
          </p>
        </Reveal>

        <div className="mt-12 flex flex-wrap items-start justify-center gap-6">
          {alive.map((src, i) => (
            <Reveal delay={i * 0.08} key={src}>
              <div className="w-56 overflow-hidden rounded-[2rem] border border-border/60 bg-black shadow-2xl sm:w-64">
                <video
                  aria-label={`Sample video ${i + 1} produced by the pipeline`}
                  autoPlay
                  className="aspect-[9/16] w-full object-cover"
                  loop
                  muted
                  onError={() =>
                    setAlive((prev) => prev.filter((s) => s !== src))
                  }
                  playsInline
                  preload="metadata"
                  src={src}
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

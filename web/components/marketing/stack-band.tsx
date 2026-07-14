"use client";

import { LogosCarousel } from "@/components/logos-carousel";
import { Reveal } from "@/components/marketing/reveal";

/**
 * We don't have customer logos to flash — we have an honest stack.
 * Rendered as typographic wordmarks so nothing here is a fake asset.
 */
const STACK = [
  { name: "OpenAI", detail: "gpt-image · tts · whisper" },
  { name: "Grok Imagine", detail: "image-to-video" },
  { name: "Modal", detail: "serverless compute" },
  { name: "Postgres", detail: "state + ledger" },
  { name: "Ayrshare", detail: "multi-platform posting" },
  { name: "Clerk", detail: "auth" },
  { name: "ffmpeg", detail: "the master mix" },
  { name: "OpenTelemetry", detail: "stage traces" },
];

export function StackBand() {
  return (
    <section className="border-y border-border/60 bg-card/20 py-14">
      <div className="mx-auto w-full max-w-6xl px-6">
        <Reveal>
          <p className="text-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Runs on infrastructure you already trust
          </p>
        </Reveal>
        <LogosCarousel className="mt-8" columnCount={4}>
          {STACK.map((s) => (
            <div
              className="flex h-16 flex-col items-center justify-center text-center"
              key={s.name}
            >
              <span className="text-lg font-semibold tracking-tight text-foreground/80">
                {s.name}
              </span>
              <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {s.detail}
              </span>
            </div>
          ))}
        </LogosCarousel>
      </div>
    </section>
  );
}

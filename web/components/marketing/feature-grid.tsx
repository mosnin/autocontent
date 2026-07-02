"use client";

import * as React from "react";
import {
  BarChart3,
  Landmark,
  Layers,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { cn } from "@/lib/utils";

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  span?: string;
}

const FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: "Autonomous niches",
    body: "Each niche is a self-contained pipeline — ideation, scripting, keyframes, motion, voice, captions, scheduling. Define it once; it runs daily without you.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Hard spend caps",
    body: "Per-niche and per-account daily ceilings, enforced before every API call. A runaway job gets refused mid-flight, not explained afterwards.",
  },
  {
    icon: BarChart3,
    title: "The closed loop",
    body: "Daily analytics ingestion scores every post. Winning hooks feed the next round of ideation; flops become guardrails. The machine gets sharper with every upload.",
  },
  {
    icon: Terminal,
    title: "Agent-native surface",
    body: "Personal access tokens, an MCP server, and a typed SDK. Any agent or shell script can drive exactly what the dashboard drives.",
    span: "lg:col-span-2",
  },
  {
    icon: Layers,
    title: "On-model characters",
    body: "A per-niche character sheet keeps every scene visually consistent across every video — one identity, hundreds of posts.",
  },
  {
    icon: Landmark,
    title: "Receipts for everything",
    body: "A spend ledger down to the API call, OpenTelemetry traces per pipeline stage, and Sentry when something breaks at 3am.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24" id="features">
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          The system
        </p>
        <h2 className="mt-3 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything a channel needs. Nothing you have to babysit.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <FeatureCell key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}

function FeatureCell({ icon: Icon, title, body, span }: Feature) {
  return (
    <div
      className={cn(
        "group relative isolate overflow-hidden rounded-xl border border-border/60 bg-card/40 p-6 transition-colors duration-300 hover:border-brand/30",
        span,
      )}
    >
      {/* Pixel dissolve on hover — restrained: theme colors only. */}
      <PixelCanvas
        className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        colors={[
          "hsl(var(--brand) / 0.4)",
          "hsl(var(--brand) / 0.22)",
          "hsl(var(--muted-foreground) / 0.15)",
        ]}
        gap={8}
        noFocus
        speed={28}
        variant="glow"
      />
      <Icon className="size-5 text-brand" />
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

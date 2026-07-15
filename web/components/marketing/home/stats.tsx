"use client";

import * as React from "react";

import { GlassPanel, StatStrip } from "@/components/marketing/system";

export function Stats() {
  return (
    <section aria-label="By the numbers" className="mx-auto max-w-6xl px-6 py-24 md:py-28">
      <GlassPanel className="border-zinc-900/[0.08] bg-white/60 px-4 py-8 md:py-10">
        <StatStrip
          className="[&_.font-display]:text-5xl md:[&_.font-display]:text-6xl"
          stats={[
            { value: 9, label: "pipeline stages, brief to post" },
            { value: 2, label: "content formats from one brief" },
            { value: 0, prefix: "$", label: "overspend past your caps, ever" },
          ]}
        />
      </GlassPanel>
    </section>
  );
}

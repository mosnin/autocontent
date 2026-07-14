"use client";

import * as React from "react";

import { StatStrip } from "@/components/marketing/system";

export function Stats() {
  return (
    <section aria-label="By the numbers" className="mx-auto max-w-6xl px-6 py-24 md:py-28">
      <StatStrip
        stats={[
          { value: 9, label: "pipeline stages, brief to post" },
          { value: 2, label: "content formats from one brief" },
          { value: 0, prefix: "$", label: "overspend past your caps, ever" },
        ]}
      />
    </section>
  );
}

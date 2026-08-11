"use client";

import * as React from "react";

import {
  DisplayHeading,
  Kicker,
  Reveal,
  Stagger,
} from "@/components/marketing/system";

export type FaqItem = { q: string; a: string };

/**
 * Small FAQ band (used on /use-cases/ai-agents only). The page that
 * renders it also embeds the matching FAQPage JSON-LD.
 */
export function FaqBand({ items }: { items: FaqItem[] }) {
  return (
    <section
      aria-label="Frequently asked questions"
      className="mx-auto max-w-3xl px-6 py-24 md:py-28"
    >
      <Reveal className="text-center">
        <Kicker>Questions</Kicker>
        <DisplayHeading className="mt-4" size="md">
          Agents, answered.
        </DisplayHeading>
      </Reveal>
      <Stagger
        className="mt-10 divide-y divide-zinc-900/[0.06] rounded-[2rem] border border-zinc-900/[0.06] bg-white px-8 shadow-[0_8px_40px_rgba(15,23,42,0.06)]"
        gap={0.08}
      >
        {items.map((item) => (
          <div className="py-7" key={item.q}>
            <h3 className="font-display text-lg font-semibold tracking-tight text-zinc-900">
              {item.q}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
              {item.a}
            </p>
          </div>
        ))}
      </Stagger>
    </section>
  );
}

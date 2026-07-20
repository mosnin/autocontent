"use client";

import * as React from "react";
import Link from "next/link";

import { Reveal, Stagger, TextReveal } from "@/components/marketing/system";

const PILLARS = [
  {
    title: "Hard spend caps",
    desc: "Per-niche and per-campaign daily caps, enforced fail-closed. If the cap is hit, the system stops, not the budget.",
  },
  {
    title: "Human approval gates",
    desc: "Nothing publishes or spends past your threshold without a person signing off. You decide where the gate sits.",
  },
  {
    title: "Full audit trail",
    desc: "Every generation, publish, and dollar is logged with who or what triggered it, human or agent.",
  },
  {
    title: "Roles & isolation",
    desc: "Admin controls, per-client brand kits, and scoped API keys keep teams and clients cleanly separated.",
  },
];

export function Enterprise() {
  return (
    <section aria-label="Enterprise-grade controls" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <TextReveal className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
              Enterprise-grade everything.
            </TextReveal>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              Autonomy only works with control. Every automated action runs
              inside guardrails you set.
            </p>
          </div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:underline"
            href="/features/analytics"
          >
            See the controls
            <svg
              aria-hidden
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </Reveal>

        <Stagger className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div
              className="rounded-3xl border border-zinc-900/[0.06] bg-[#fafbfc] p-6"
              key={p.title}
            >
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-xl bg-zinc-900 text-white"
              >
                <svg
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.75"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-zinc-900">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                {p.desc}
              </p>
            </div>
          ))}
        </Stagger>

        {/* Compliance badge slots — real marks land when certifications do. */}
        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-zinc-900/[0.06] pt-8">
          <p className="mr-2 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
            Compliance
          </p>
          {["soc2.svg", "gdpr.svg", "ccpa.svg"].map((f) => (
            <span
              className="flex h-10 w-24 items-center justify-center rounded-lg border border-dashed border-zinc-900/10 bg-zinc-50 font-mono text-[10px] text-zinc-300"
              key={f}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

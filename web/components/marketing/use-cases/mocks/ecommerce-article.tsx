"use client";

import * as React from "react";

import { GlassPanel } from "@/components/marketing/system";
import { cn } from "@/lib/utils";
import { MiniPill, MockHeader } from "./bits";

const META_CHIPS = [
  "slug: best-espresso-grinders-under-200",
  "title 54 chars",
  "meta 156 chars",
  "Product JSON-LD",
  "hero image",
];

const PIPELINE = [
  { label: "SERP research", done: true },
  { label: "Outline", done: true },
  { label: "6 sections, written in parallel", done: true },
  { label: "QA pass", done: true },
];

/**
 * Ecommerce product moment: a finished SEO buying guide with its search
 * preview, slug and metadata chips, and the pipeline receipts behind it.
 */
export function EcommerceArticleMock({ className }: { className?: string }) {
  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <MockHeader
        chip={<MiniPill tone="ok">Ready to publish</MiniPill>}
        title="SEO article"
      />
      <div className="mt-4 rounded-xl border border-zinc-900/[0.05] bg-white/80 p-3.5">
        <p className="truncate text-[11px] text-emerald-700">
          yourstore.com/guides/best-espresso-grinders-under-200
        </p>
        <p className="mt-1 text-[13px] font-medium leading-snug text-sky-800">
          Best espresso grinders under $200: 7 tested picks
        </p>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-zinc-500">
          We dialed in 7 grinders against the same beans and budget. Two are
          worth your counter, one embarrasses grinders twice its price.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {META_CHIPS.map((chip) => (
          <span
            className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 font-mono text-[10px] font-medium text-zinc-500"
            key={chip}
          >
            {chip}
          </span>
        ))}
      </div>
      <ul className="mt-4 space-y-1.5 border-t border-zinc-900/[0.06] pt-4">
        {PIPELINE.map((step) => (
          <li
            className="flex items-center gap-2 text-[12px] text-zinc-500"
            key={step.label}
          >
            <svg
              aria-hidden
              className="size-3 text-emerald-600"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
            {step.label}
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

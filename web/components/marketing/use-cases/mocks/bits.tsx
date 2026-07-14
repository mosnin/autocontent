"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { warmChip } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/** The recording light: a small pulsing brand-orange dot. */
export function PulseDot({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={cn("relative flex size-2", className)}>
      {!reduced && (
        <motion.span
          animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
          className="absolute inline-flex h-full w-full rounded-full bg-brand"
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

/** Tiny status chip used across the product-moment mocks. */
export function MiniPill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "live" | "ok" | "wait";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "neutral" && "border-zinc-900/10 bg-white/80 text-zinc-500",
        tone === "live" && "border-brand/20 bg-brand/[0.07] text-zinc-700",
        tone === "ok" && warmChip,
        tone === "wait" && "border-amber-500/20 bg-amber-50/80 text-amber-700",
        className,
      )}
    >
      {tone === "live" && <PulseDot />}
      {tone === "ok" && (
        <svg
          aria-hidden
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      )}
      {children}
    </span>
  );
}

/** Mock card header: bold title left, a chip on the right. */
export function MockHeader({
  title,
  chip,
}: {
  title: string;
  chip?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-900/[0.06] pb-4">
      <p className="text-[13px] font-semibold text-zinc-900">{title}</p>
      {chip}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { HUB_EASE } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";

/**
 * The reference-style dashboard kit (light mode): every product landing is
 * built from these pieces so the five dashboards read as one family.
 *
 * Page anatomy (top to bottom), mirroring the reference:
 *   <DashHeading>  — big sparkle greeting ("Bring any idea to life ✦")
 *   <BannerCard>×2 — huge feature banners: bold title + inline tagline +
 *                    ↗ circle, media vignette filling the card body
 *   <DashHeading>  — second heading
 *   <MediaCard>×4  — tool cards: title + ↗, vignette media area
 *   …then the product's functional content in <DashPanel> sections.
 */

/* ------------------------------------------------------------------ */

export type DashTone = "warm" | "sky" | "violet" | "slate" | "rose";

/** Duotone gradients for the card media wells — saturated pastel. */
const MEDIA_TONES: Record<DashTone, string> = {
  warm: "linear-gradient(135deg,#fff3e4,#ffe1d6 50%,#ffd9e4)",
  sky: "linear-gradient(135deg,#e3edfe,#dbe4fd 50%,#e6ddfc)",
  violet: "linear-gradient(135deg,#efeafe,#e4dcfc 50%,#f6ddf3)",
  rose: "linear-gradient(135deg,#ffe9ec,#fdd8e2)",
  slate: "linear-gradient(135deg,#fafbfd,#eef1f7)",
};

export function DashRise({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: reduced ? 0.15 : 0.65, ease: HUB_EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Big section greeting, reference-style: bold, roomy, sparkle after. */
export function DashHeading({
  children,
  sub,
  delay = 0,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
  delay?: number;
  as?: "h1" | "h2";
}) {
  return (
    <DashRise delay={delay}>
      <Tag className="flex items-center gap-2.5 text-[1.6rem] font-bold tracking-tight md:text-3xl">
        {children}
        <Sparkles aria-hidden className="size-5 shrink-0 text-brand" />
      </Tag>
      {sub ? <div className="mt-1.5 text-sm text-muted-foreground">{sub}</div> : null}
    </DashRise>
  );
}

/** The ↗ circle every card carries in the top-right corner. */
function ArrowCircle({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-border/80 bg-card text-foreground/70 transition-all group-hover:border-foreground group-hover:bg-foreground group-hover:text-background",
        size === "lg" ? "size-10" : "size-8",
      )}
    >
      <ArrowUpRight
        aria-hidden
        className={cn(
          "transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
          size === "lg" ? "size-5" : "size-4",
        )}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Large feature banner — the reference's hero cards ("AI Toolkit",
 * "Artlist Studio"): a huge bold title with the tagline beside it, an ↗
 * circle far right, and a tall media vignette filling the body.
 */
export function BannerCard({
  href,
  title,
  tagline,
  badge,
  media,
  tone,
  className,
}: {
  href: string;
  title: string;
  tagline: string;
  badge?: string;
  media: React.ReactNode;
  tone?: DashTone;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn("h-full", className)}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
      whileHover={reduced ? undefined : { y: -5 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
    >
      <Link
        className="group flex h-full flex-col rounded-[1.75rem] border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_16px_48px_-28px_rgb(0_0_0/0.25)] transition-shadow hover:shadow-[0_2px_6px_rgb(0_0_0/0.05),0_28px_64px_-28px_rgb(0_0_0/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-2xl font-bold tracking-tight md:text-[1.7rem]">
              {title}
            </h3>
            {badge ? (
              <span className="rounded-full border border-border/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {badge}
              </span>
            ) : null}
            <p className="w-full text-sm text-muted-foreground md:w-auto">
              {tagline}
            </p>
          </div>
          <ArrowCircle size="lg" />
        </div>
        <div
          className="flex-1 overflow-hidden rounded-2xl border border-border/60"
          style={{ background: MEDIA_TONES[tone ?? "slate"] }}
        >
          <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]">
            {media}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

/**
 * Tool/media card — the reference's second row ("AI Image", "AI Video"…):
 * title + ↗, then a media vignette.
 */
export function MediaCard({
  href,
  title,
  media,
  foot,
  tone,
  className,
}: {
  href: string;
  title: string;
  media: React.ReactNode;
  foot?: React.ReactNode;
  tone?: DashTone;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn("h-full", className)}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      whileHover={reduced ? undefined : { y: -4 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
    >
      <Link
        className="group flex h-full flex-col rounded-3xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_10px_32px_-22px_rgb(0_0_0/0.2)] transition-shadow hover:shadow-[0_2px_4px_rgb(0_0_0/0.05),0_20px_48px_-24px_rgb(0_0_0/0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
      >
        <div className="mb-3 flex items-center justify-between gap-3 px-1 pt-0.5">
          <h3 className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h3>
          <ArrowCircle />
        </div>
        <div
          className="flex-1 overflow-hidden rounded-xl border border-border/60"
          style={{ background: MEDIA_TONES[tone ?? "slate"] }}
        >
          <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]">
            {media}
          </div>
        </div>
        {foot ? (
          <div className="px-1 pt-3 text-xs text-muted-foreground">{foot}</div>
        ) : null}
      </Link>
    </motion.div>
  );
}

/** Panel wrapper for the product's functional content below the hero rows. */
export function DashPanel({
  title,
  actions,
  children,
  delay = 0,
  className,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <DashRise className={className} delay={delay}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {title}
            <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
          </h2>
          {actions}
        </div>
      ) : null}
      {children}
    </DashRise>
  );
}

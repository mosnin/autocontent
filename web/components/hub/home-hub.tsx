"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { productById } from "@/lib/products";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ------------------------------------------------------------------ */
/* Motion primitives — one rhythm for the whole hub                    */
/* ------------------------------------------------------------------ */

function Rise({
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
      initial={reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: reduced ? 0.15 : 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Card chrome shared by every hub tile: rounded panel, top-right arrow,
 *  soft hover lift — the reference's card language in light mode. */
function HubCard({
  href,
  title,
  desc,
  badge,
  children,
  className,
}: {
  href: string;
  title: string;
  desc?: string;
  badge?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn("h-full", className)}
      whileHover={reduced ? undefined : { y: -4 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
    >
      <Link
        className={cn(
          "group flex h-full flex-col rounded-3xl border border-border/70 bg-card p-5",
          "shadow-[0_1px_2px_rgb(0_0_0/0.03),0_10px_32px_-20px_rgb(0_0_0/0.18)]",
          "transition-shadow hover:shadow-[0_2px_4px_rgb(0_0_0/0.04),0_20px_48px_-20px_rgb(0_0_0/0.25)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        href={href}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
            {badge ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {badge}
              </span>
            ) : null}
            {desc ? (
              <p className="w-full truncate text-sm text-muted-foreground sm:w-auto">
                {desc}
              </p>
            ) : null}
          </div>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-all group-hover:border-foreground group-hover:text-foreground">
            <ArrowUpRight
              aria-hidden
              className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </span>
        </div>
        {children}
      </Link>
    </motion.div>
  );
}

function SectionHeading({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Rise delay={delay}>
      <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        {children}
        <Sparkles aria-hidden className="size-4 text-brand" />
      </h2>
    </Rise>
  );
}

/* ------------------------------------------------------------------ */
/* Hand-built vignettes (light mode) — product previews, not images    */
/* ------------------------------------------------------------------ */

function VignetteFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mt-auto overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(135deg,#fafafa,#f2f4f8)] p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CampaignsVignette() {
  return (
    <VignetteFrame className="min-h-44">
      <div className="space-y-2">
        {[
          { name: "Spring launch", meta: "4 videos · 2 articles · 1 ad set", pct: 72 },
          { name: "Evergreen SEO", meta: "8 articles queued", pct: 45 },
          { name: "UGC push", meta: "6 shorts scheduled", pct: 90 },
        ].map((c) => (
          <div
            className="rounded-xl border border-border/60 bg-card px-3 py-2.5"
            key={c.name}
          >
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">{c.meta}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#f43f5e)]"
                style={{ width: `${c.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </VignetteFrame>
  );
}

function ContentVignette() {
  return (
    <VignetteFrame className="min-h-44">
      <div className="grid grid-cols-4 gap-2">
        {["Hook A", "Hook B", "Hook C", "Hook D"].map((h, i) => (
          <div
            className="flex aspect-[9/13] flex-col justify-between rounded-lg border border-border/60 bg-card p-1.5"
            key={h}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[8px] text-white",
                i === 1 ? "bg-rose-500" : "bg-zinc-900",
              )}
            >
              ▶
            </span>
            <span className="text-[9px] font-medium text-muted-foreground">
              {h}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
        </span>
        Rendering scene 4 of 6 — tonight&apos;s queue
      </p>
    </VignetteFrame>
  );
}

function SeoVignette() {
  return (
    <VignetteFrame>
      <div className="space-y-1.5 text-[11.5px]">
        {[
          { kw: "best hiking gear 2026", pos: "#3", up: true },
          { kw: "trail runner buying guide", pos: "#7", up: true },
          { kw: "waterproof jacket review", pos: "#12", up: false },
        ].map((r) => (
          <div
            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-2.5 py-1.5"
            key={r.kw}
          >
            <span className="truncate text-muted-foreground">{r.kw}</span>
            <span
              className={cn(
                "ml-2 font-mono text-[10.5px] font-semibold",
                r.up ? "text-amber-600" : "text-muted-foreground",
              )}
            >
              {r.pos} {r.up ? "↑" : "·"}
            </span>
          </div>
        ))}
      </div>
    </VignetteFrame>
  );
}

function AdsVignette() {
  return (
    <VignetteFrame>
      <div className="flex items-end justify-between gap-1.5">
        {[34, 52, 41, 66, 58, 74, 47].map((h, i) => (
          <div
            className={cn(
              "w-full rounded-t-[3px]",
              i === 5 ? "bg-[linear-gradient(180deg,#f59e0b,#f43f5e)]" : "bg-zinc-900/15",
            )}
            key={i}
            style={{ height: h * 0.9 }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">Daily cap $25.00</span>
        <span className="font-medium text-amber-600">$16.40 spent · capped</span>
      </div>
    </VignetteFrame>
  );
}

function SuiteVignette() {
  return (
    <VignetteFrame>
      <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
        {["Brand kit", "Billing", "Tokens", "Admin"].map((s) => (
          <div
            className="rounded-lg border border-border/60 bg-card px-2.5 py-2 font-medium text-muted-foreground"
            key={s}
          >
            {s}
          </div>
        ))}
      </div>
    </VignetteFrame>
  );
}

/* ------------------------------------------------------------------ */
/* The hub                                                             */
/* ------------------------------------------------------------------ */

export function HomeHub() {
  const reduced = useReducedMotion();
  const campaigns = productById("campaigns");
  const content = productById("studio");
  const seo = productById("press");
  const ads = productById("ads");
  const suite = productById("suite");

  const stagger = (i: number) => (reduced ? 0 : 0.08 * i);

  return (
    <div className="mx-auto max-w-6xl space-y-12">
      {/* Hero row: the two flagship dashboards */}
      <section aria-label="Start here" className="space-y-5">
        <SectionHeading>Bring your next campaign to life</SectionHeading>
        <div className="grid gap-5 lg:grid-cols-2">
          <Rise delay={stagger(1)}>
            <HubCard
              desc={campaigns.tagline}
              href={campaigns.home}
              title="Campaigns"
            >
              <CampaignsVignette />
            </HubCard>
          </Rise>
          <Rise delay={stagger(2)}>
            <HubCard badge="Studio" desc={content.tagline} href={content.home} title="Content">
              <ContentVignette />
            </HubCard>
          </Rise>
        </div>
      </section>

      {/* Product rail: the rest of the suite, in order */}
      <section aria-label="All products" className="space-y-5">
        <SectionHeading delay={stagger(3)}>Work in every surface</SectionHeading>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Rise delay={stagger(4)}>
            <HubCard badge="Press" desc="Articles & search" href={seo.home} title="SEO">
              <SeoVignette />
            </HubCard>
          </Rise>
          <Rise delay={stagger(5)}>
            <HubCard desc="Paid campaigns, capped" href={ads.home} title="Ads">
              <AdsVignette />
            </HubCard>
          </Rise>
          <Rise delay={stagger(6)}>
            <HubCard desc="Account, brand, admin" href={suite.home} title="Suite">
              <SuiteVignette />
            </HubCard>
          </Rise>
        </div>
      </section>

      {/* Quick actions strip */}
      <section aria-label="Quick actions" className="space-y-5">
        <SectionHeading delay={stagger(7)}>Jump back in</SectionHeading>
        <Rise className="flex flex-wrap gap-2.5" delay={stagger(8)}>
          {[
            { label: "New campaign", href: "/campaigns" },
            { label: "Queue a short", href: "/queue" },
            { label: "Draft an article", href: "/articles" },
            { label: "Review ad approvals", href: "/ads/approvals" },
            { label: "Connect socials", href: "/connect" },
            { label: "Top up credits", href: "/settings/billing" },
          ].map((a) => (
            <Link
              className="rounded-full border border-border/70 bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={a.href}
              key={a.label}
            >
              {a.label}
            </Link>
          ))}
        </Rise>
      </section>
    </div>
  );
}

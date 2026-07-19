"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import TextType from "@/components/reactbits/TextType";
import { BannerCard, MediaCard } from "@/components/hub/dashboard-kit";
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
    <div className={cn("relative flex h-full flex-col justify-center p-4", className)}>
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
        <div className="space-y-1.5">
          <SectionHeading>Bring your next campaign to life</SectionHeading>
          <Rise delay={reduced ? 0 : 0.05}>
            <TextType
              as="p"
              className="text-sm text-muted-foreground"
              cursorCharacter="▍"
              pauseDuration={2200}
              text={[
                "What are we shipping today?",
                "Queue a short. Draft an article. Cap the spend.",
                "Your agents are on the clock.",
              ]}
              typingSpeed={40}
            />
          </Rise>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Rise delay={stagger(1)}>
            <BannerCard
              href={campaigns.home}
              media={<CampaignsVignette />}
              tagline={campaigns.tagline}
              title="Campaigns"
            />
          </Rise>
          <Rise delay={stagger(2)}>
            <BannerCard
              badge="Studio"
              href={content.home}
              media={<ContentVignette />}
              tagline={content.tagline}
              title="Content"
            />
          </Rise>
        </div>
      </section>

      {/* Product rail: the rest of the suite, in order */}
      <section aria-label="All products" className="space-y-5">
        <SectionHeading delay={stagger(3)}>Work in every surface</SectionHeading>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Rise delay={stagger(4)}>
            <MediaCard
              foot="Press — articles & search"
              href={seo.home}
              media={<SeoVignette />}
              title="SEO"
            />
          </Rise>
          <Rise delay={stagger(5)}>
            <MediaCard
              foot="Paid campaigns, capped"
              href={ads.home}
              media={<AdsVignette />}
              title="Ads"
            />
          </Rise>
          <Rise delay={stagger(6)}>
            <MediaCard
              foot="Account, brand, admin"
              href={suite.home}
              media={<SuiteVignette />}
              title="Suite"
            />
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

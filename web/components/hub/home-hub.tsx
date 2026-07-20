"use client";

import * as React from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";

import TextType from "@/components/reactbits/TextType";
import { BannerCard, MediaCard } from "@/components/hub/dashboard-kit";
import { HubHeading, Rise } from "@/components/hub/primitives";
import { MediaSlot } from "@/components/media-slot";
import { productById } from "@/lib/products";

/* ------------------------------------------------------------------ */
/* Motion primitives — one rhythm for the whole hub                    */
/* ------------------------------------------------------------------ */

function SectionHeading({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Rise delay={delay}>
      <HubHeading as="h2" className="text-2xl">
        {children}
      </HubHeading>
    </Rise>
  );
}

/* ------------------------------------------------------------------ */
/* Media — always the managed slot; its own empty-state placeholder    */
/* art shows until an admin uploads a real image (see media-slot.tsx). */
/* ------------------------------------------------------------------ */

function HubMedia({ id }: { id: string }) {
  return (
    <div className="h-full min-h-44 w-full">
      <MediaSlot id={id} showChip={false} />
    </div>
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
              media={<HubMedia id="dash-home-campaigns" />}
              tagline={campaigns.tagline}
              title="Campaigns"
              tone="warm"
            />
          </Rise>
          <Rise delay={stagger(2)}>
            <BannerCard
              badge="Studio"
              href={content.home}
              media={<HubMedia id="dash-home-content" />}
              tagline={content.tagline}
              title="Content"
              tone="sky"
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
              media={<HubMedia id="dash-home-seo" />}
              title="SEO"
              tone="violet"
            />
          </Rise>
          <Rise delay={stagger(5)}>
            <MediaCard
              foot="Paid campaigns, capped"
              href={ads.home}
              media={<HubMedia id="dash-home-ads" />}
              title="Ads"
              tone="warm"
            />
          </Rise>
          <Rise delay={stagger(6)}>
            <MediaCard
              foot="Account, brand, admin"
              href={suite.home}
              media={<HubMedia id="dash-home-suite" />}
              title="Suite"
              tone="slate"
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

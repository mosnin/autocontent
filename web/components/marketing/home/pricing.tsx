"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode } from "react";

type Tier = {
  name: string;
  blurb: string;
  monthly: number;
  yearly: number;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    blurb: "See if it fits.",
    monthly: 5,
    yearly: 5,
    features: [
      "≈ 8–12 videos",
      "Every feature included",
      "No subscription",
      "Credits never expire",
    ],
    cta: "Buy $5 of credit",
  },
  {
    name: "Creator",
    blurb: "A daily channel.",
    monthly: 20,
    yearly: 20,
    features: [
      "≈ 35–50 videos",
      "Improves from what performed",
      "Review-before-post",
      "Every feature included",
    ],
    cta: "Buy $20 of credit",
    highlighted: true,
  },
  {
    name: "Studio",
    blurb: "Several niches at once.",
    monthly: 50,
    yearly: 50,
    features: [
      "≈ 90–125 videos",
      "Per-niche spend caps",
      "API + MCP access",
      "Every feature included",
    ],
    cta: "Buy $50 of credit",
  },
];

function PriceValue({
  value,
  yearly,
  reduce,
}: {
  value: number;
  yearly: boolean;
  reduce: boolean;
}): ReactNode {
  const enterY = reduce ? 0 : yearly ? "-110%" : "110%";
  const exitY = reduce ? 0 : yearly ? "110%" : "-110%";

  return (
    <span className="relative inline-flex overflow-hidden leading-none tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: enterY, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: exitY, opacity: 0 }}
          transition={{ duration: reduce ? 0.001 : 0.45, ease: softEase }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function TierCard({
  tier,
  yearly,
  reduce,
}: {
  tier: Tier;
  yearly: boolean;
  reduce: boolean;
}): ReactNode {
  const highlighted = tier.highlighted === true;
  const price = yearly ? tier.yearly : tier.monthly;

  return (
    <article
      style={
        highlighted
          ? {
              backgroundColor: "var(--surface)",
              color: "var(--surface-foreground)",
            }
          : undefined
      }
      className={cn(
        "flex h-full flex-col rounded-3xl p-7 sm:p-8",
        !highlighted && "border-border border"
      )}
    >
      <header className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-medium tracking-tight">{tier.name}</h3>
        {highlighted && (
          <span className="rounded-full border border-current/25 px-2.5 py-1 text-[11px] leading-none font-medium">
            Most popular
          </span>
        )}
      </header>
      <p
        className={cn(
          "mt-1.5 text-sm",
          highlighted ? "opacity-65" : "text-muted-foreground"
        )}
      >
        {tier.blurb}
      </p>

      <div className="mt-8 flex items-end">
        <span className="self-start pt-1 text-xl font-medium tracking-tight">
          $
        </span>
        <span className="text-5xl leading-none font-medium tracking-tight">
          <PriceValue value={price} yearly={yearly} reduce={reduce} />
        </span>
        <span
          className={cn(
            "ml-2 pb-0.5 text-sm",
            highlighted ? "opacity-65" : "text-muted-foreground"
          )}
        >
          / once
        </span>
      </div>
      <p
        className={cn(
          "mt-2 h-4 text-xs",
          highlighted ? "opacity-65" : "text-muted-foreground"
        )}
      >
        one-time · credits never expire
      </p>

      <ul className="mt-8 flex-1 space-y-3">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <Check
              className={cn(
                "mt-0.5 size-4 shrink-0",
                highlighted ? "opacity-80" : "text-foreground"
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-sm leading-relaxed",
                highlighted ? "opacity-80" : "text-muted-foreground"
              )}
            >
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <a
        href="/sign-up"
        style={
          highlighted
            ? {
                backgroundColor: "var(--surface-foreground)",
                color: "var(--surface)",
              }
            : undefined
        }
        className={cn(
          "focus-ring mt-9 inline-flex h-12 items-center justify-center rounded-full text-sm font-medium transition-opacity hover:opacity-85",
          !highlighted &&
            "border-border text-foreground hover:bg-muted border hover:opacity-100"
        )}
      >
        {tier.cta}
      </a>
    </article>
  );
}

export function Pricing(): ReactNode {
  const reduce = useReducedMotion();
  const yearly = false;

  return (
    <section
      id="pricing"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <div>
        <SectionHeading
          title="Pay for what ships. Nothing else."
          description="Three prepaid credit packs. Every render metered, every dollar capped, no subscription anywhere."
        />
      </div>

      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <TierCard
            key={tier.name}
            tier={tier}
            yearly={yearly}
            reduce={reduce}
          />
        ))}
      </div>

      <p className="text-muted-foreground mt-6 text-xs">
        One-time purchases through Stripe. Top up whenever, in any mix. Credits
        do not expire.
      </p>
    </section>
  );
}

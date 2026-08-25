import * as React from "react";

import { PACKS } from "@/components/marketing/pricing-data";
import { CtaPill, Magnetic, Stagger } from "@/components/marketing/system";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/**
 * Prepaid packs as Cortex pricing cards: inverted featured tile, hairline
 * others, medium-weight type, rounded-full CTAs.
 */
export function PricingTiles() {
  return (
    <Stagger
      className="grid items-stretch gap-4 sm:grid-cols-3"
      gap={0.08}
      itemClassName="h-full"
    >
      {PACKS.map((pack) => {
        const featured = Boolean(pack.featured);
        return (
          <article
            className={cn(
              "relative flex h-full flex-col rounded-3xl p-7 sm:p-8",
              !featured && "border-border border",
            )}
            key={pack.label}
            style={
              featured
                ? {
                    backgroundColor: "var(--surface)",
                    color: "var(--surface-foreground)",
                  }
                : undefined
            }
          >
            <header className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-medium tracking-tight">{pack.label}</h3>
              {featured ? (
                <span className="rounded-full border border-current/25 px-2.5 py-1 text-[11px] leading-none font-medium">
                  Most popular
                </span>
              ) : null}
            </header>
            <p
              className={cn(
                "mt-1.5 text-sm",
                featured ? "opacity-65" : "text-muted-foreground",
              )}
            >
              {pack.blurb}
            </p>
            <div className="mt-8 flex items-end">
              <span className="self-start pt-1 text-xl font-medium tracking-tight">
                $
              </span>
              <span className="text-5xl leading-none font-medium tracking-tight tabular-nums">
                {pack.amount}
              </span>
              <span
                className={cn(
                  "ml-2 pb-0.5 text-sm",
                  featured ? "opacity-65" : "text-muted-foreground",
                )}
              >
                / once
              </span>
            </div>
            <ul className="mt-8 flex-1 space-y-3">
              {pack.points.map((point) => (
                <li className="flex items-start gap-2.5" key={point}>
                  <Check
                    aria-hidden
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      featured ? "opacity-80" : "text-foreground",
                    )}
                    strokeWidth={2}
                  />
                  <span
                    className={cn(
                      "text-sm leading-relaxed",
                      featured ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    {point}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-9">
              {featured ? (
                <Magnetic className="block w-full">
                  <CtaPill
                    className="w-full justify-center border-0 hover:opacity-85"
                    href="/sign-up"
                    style={{
                      backgroundColor: "var(--surface-foreground)",
                      color: "var(--surface)",
                    }}
                    variant="primary"
                  >
                    Buy ${pack.amount} of credit
                  </CtaPill>
                </Magnetic>
              ) : (
                <CtaPill
                  className="w-full justify-center"
                  href="/sign-up"
                  variant="secondary"
                >
                  Buy ${pack.amount} of credit
                </CtaPill>
              )}
            </div>
          </article>
        );
      })}
    </Stagger>
  );
}

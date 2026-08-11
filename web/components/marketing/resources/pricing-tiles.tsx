import * as React from "react";

import { PACKS } from "@/components/marketing/pricing-data";
import {
  Btn,
  Bullets,
  Card,
  CardGrid,
  Eyebrow,
} from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * The three prepaid packs from pricing-data.ts as full pricing tiles. The
 * featured pack carries the accent hairline and a "Most popular" flag.
 */
export function PricingTiles() {
  return (
    <CardGrid>
      {PACKS.map((pack) => (
        <Card
          className={cn("os-pack", pack.featured && "os-pack--featured")}
          key={pack.label}
          padding="lg"
          tone={pack.featured ? "accent" : "surface"}
        >
          {pack.featured ? (
            <span className="os-pack__flag">Most popular</span>
          ) : null}
          <Eyebrow>{pack.label}</Eyebrow>
          <p className="os-pack__price">
            ${pack.amount}
            <span className="os-pack__unit">once</span>
          </p>
          <p className="os-body os-mt-8">{pack.blurb}</p>
          <Bullets className="os-mt-32" items={pack.points} />
          <div className="os-mt-auto os-pack__cta">
            <Btn
              block
              href="/sign-up"
              variant={pack.featured ? "primary" : "secondary"}
            >
              Buy ${pack.amount} of credit
            </Btn>
          </div>
        </Card>
      ))}
    </CardGrid>
  );
}

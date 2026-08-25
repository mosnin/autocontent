import * as React from "react";

import { Body, Card, CardGrid, Chip, Title } from "@/components/site/sections";

export interface Spec {
  name: string;
  /** Mono chips naming the declared capability - durations, ratios, tiers. */
  chips?: string[];
  copy: string;
}

/**
 * A catalog rendered as hairline cards: name, the mono chips that state its
 * declared capabilities, one line of what it is for. Used for the UGC model
 * catalog, the motion style catalog, and the creative-direction catalog, all
 * of which are code-level registries in the product.
 */
export function SpecCards({
  items,
  cols = 3,
  className,
}: {
  items: Spec[];
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <CardGrid className={className} cols={cols}>
      {items.map((item) => (
        <Card key={item.name}>
          <Title size="sm">{item.name}</Title>
          {item.chips && item.chips.length > 0 ? (
            <div className="os-actions os-mt-12">
              {item.chips.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </div>
          ) : null}
          <Body className="os-mt-12">{item.copy}</Body>
        </Card>
      ))}
    </CardGrid>
  );
}

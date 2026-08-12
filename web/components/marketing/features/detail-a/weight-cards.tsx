import * as React from "react";

import { Body, Card, CardGrid, Title } from "@/components/site/sections";

export interface Weight {
  name: string;
  /** Points this row is worth out of the whole. */
  points: number;
  /** Denominator printed next to the points. */
  outOf?: number;
  copy: string;
}

/**
 * A weighted breakdown: each row shows what it is worth, a hairline meter
 * sized to its share of the largest row, and one line of explanation. Built
 * from the export's `os-score` / `os-meter` pair so the numbers read in the
 * same display face as the rest of the site.
 */
export function WeightCards({
  items,
  outOf = 100,
  cols = 3,
  className,
}: {
  items: Weight[];
  outOf?: number;
  cols?: 2 | 3;
  className?: string;
}) {
  const largest = items.reduce((m, i) => Math.max(m, i.points), 0) || 1;

  return (
    <CardGrid className={className} cols={cols}>
      {items.map((item) => (
        <Card key={item.name}>
          <Title size="sm">{item.name}</Title>
          <div className="os-scorehead os-mt-16">
            <p className="os-score">{item.points}</p>
            <p className="os-score__of">of {item.outOf ?? outOf} pts</p>
          </div>
          <div aria-hidden className="os-meter os-mt-12">
            <div
              className="os-meter__fill"
              style={{ width: `${Math.round((item.points / largest) * 100)}%` }}
            />
          </div>
          <Body className="os-mt-16">{item.copy}</Body>
        </Card>
      ))}
    </CardGrid>
  );
}

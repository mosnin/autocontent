import * as React from "react";

import { Body, Card, CardGrid, Chip, Title } from "@/components/site/sections";

export interface Fact {
  /** Mono over-line: the category, the surface, the platform. */
  kicker?: string;
  title: string;
  copy: string;
  /** Mono chips stating a declared limit or capability. */
  chips?: string[];
}

/**
 * Hairline cards in the homepage's tile rhythm: a mono over-line, the
 * 24px Inter Display title, one paragraph, and the chips that state what
 * the thing is bounded by.
 *
 * `detail-a/spec-cards` renders a *catalog* (name + capability chips);
 * this renders a *claim* (category + title + explanation), which is the
 * shape the four pipeline pages need for "here are the three ceilings" or
 * "here are the four surfaces". Keeping them separate means neither grows
 * a mode flag.
 */
export function FactCards({
  items,
  cols = 3,
  className,
}: {
  items: Fact[];
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <CardGrid className={className} cols={cols}>
      {items.map((item) => (
        <Card key={item.title}>
          {item.kicker ? <p className="os-meta">{item.kicker}</p> : null}
          <Title className={item.kicker ? "os-mt-12" : undefined}>
            {item.title}
          </Title>
          <Body className="os-mt-12">{item.copy}</Body>
          {item.chips && item.chips.length > 0 ? (
            <div className="os-actions os-mt-24">
              {item.chips.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </CardGrid>
  );
}

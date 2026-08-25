import * as React from "react";

import { Body, Chip, Title } from "@/components/site/sections";
import { cn } from "@/lib/utils";

export interface RailStep {
  /** The stage's own name - ideally the literal status the product uses. */
  label: string;
  copy: string;
  /** Mono chip naming the artifact or guarantee the stage produces. */
  tag?: string;
}

/**
 * An ordered rail: a hairline spine with a small accent node beside every
 * step. The `os-rail` / `os-rail__node` pair already existed in
 * `sections.css` for exactly this shape but had no call site, so the four
 * pipeline pages that need to state their real stage order in sequence
 * (rather than as a two-column grid, which `detail-a/stage-grid` already
 * covers) render through it instead of inventing a second vocabulary.
 *
 * Server component, no JS: it is a list.
 */
export function StageRail({
  steps,
  className,
  numbered = true,
}: {
  steps: RailStep[];
  className?: string;
  numbered?: boolean;
}) {
  return (
    <ol className={cn("os-stack os-gap-28", className)}>
      {steps.map((step, i) => (
        <li className="os-rail" key={step.label}>
          <span aria-hidden className="os-rail__node" />
          <div className="os-stagecell__head">
            {numbered ? (
              <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
            ) : null}
            <Title level={3} size="sm">
              {step.label}
            </Title>
            {step.tag ? <Chip>{step.tag}</Chip> : null}
          </div>
          <Body className="os-mt-8 os-measure">{step.copy}</Body>
        </li>
      ))}
    </ol>
  );
}

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import { Stagger } from "./reveal";

export type Stat = {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

/**
 * Horizontal band of counted-up stats with hairline dividers.
 * Max 3 CountUps per page (spec), so keep `stats` to three.
 */
export function StatStrip({
  stats,
  className,
}: {
  stats: Stat[];
  className?: string;
}) {
  return (
    <Stagger
      className={cn(
        "grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
      gap={0.08}
    >
      {stats.map((s) => (
        <div className="px-8 py-8 text-center sm:py-4" key={s.label}>
          <p className="font-display text-4xl font-medium tabular-nums tracking-tight text-foreground md:text-5xl">
            <CountUp
              decimals={s.decimals ?? 0}
              prefix={s.prefix}
              suffix={s.suffix}
              value={s.value}
            />
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </Stagger>
  );
}

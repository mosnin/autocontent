"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";

export type Stat = {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

/**
 * Band of counted-up stats in one hairline container, divided by the same
 * rgb(42,60,58) rules the rest of the site uses. Keep `stats` to three.
 */
export function StatStrip({
  stats,
  className,
}: {
  stats: Stat[];
  className?: string;
}) {
  return (
    <div className={cn("os-stats", className)}>
      {stats.map((s) => (
        <div className="os-stat" key={s.label}>
          <p className="os-stat__value">
            <CountUp
              decimals={s.decimals ?? 0}
              prefix={s.prefix}
              suffix={s.suffix}
              value={s.value}
            />
          </p>
          <p className="os-stat__label">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

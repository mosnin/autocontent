"use client";

// Square UI "marketing-dashboard" template stats-cards, ported faithfully.
// Swaps per the port contract: mock dashboardStats -> real values passed in
// as props by the page. The template's label-row icons and invented trend
// deltas are the one intentional omission — no decorative icons in page
// content and no fake numbers; the right-hand slot in the value card shows
// a real supplementary datum (or a real link) instead.

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SquareStat {
  key: string;
  label: string;
  value: string;
  /** Real supplementary datum shown beside the value (e.g. "42% of cap"). */
  trail?: string;
  trailTone?: "default" | "warn";
  /** Real link rendered in the trail slot when there is no datum yet. */
  trailLink?: { href: string; label: string };
}

export function SquareStatsCards({ stats }: { stats: SquareStat[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map(({ key, label, value, trail, trailTone, trailLink }) => (
        <div
          key={key}
          className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
          </div>
          <div className="rounded-md border bg-card p-3 flex items-center justify-between">
            <span className="text-2xl font-semibold tracking-tight">
              {value}
            </span>
            {trail !== undefined ? (
              <span
                className={cn(
                  "text-sm font-medium",
                  trailTone === "warn" ? "text-brand" : "text-muted-foreground"
                )}
              >
                {trail}
              </span>
            ) : trailLink ? (
              <Link
                href={trailLink.href}
                className="text-sm font-medium text-brand hover:underline"
              >
                {trailLink.label}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// Square UI "marketing-dashboard" template stats-cards, ported verbatim —
// card chrome, label-row icons, and the trend/delta row all kept. The only
// change is parameterization: the template's mock `dashboardStats` +
// hardcoded `statsConfig` become props so the page supplies real values.
// Delta slots carry real derivable values passed in by the page; a stat
// with no real delta renders "—" (never an invented percentage).

import {
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SquareStat {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Preformatted real value (e.g. "$12,3" / "19,546,889"). */
  value: string;
  /**
   * Real derivable delta for the template's trend slot (e.g. spend as % of
   * cap). `trend` picks the template's up (emerald) / down (destructive)
   * arrow + tone; omit `trend` to render the text muted with no arrow;
   * omit `delta` entirely to render "—".
   */
  delta?: { text: string; trend?: "up" | "down" } | null;
}

export function SquareStatsCards({ stats }: { stats: SquareStat[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map(({ key, label, icon: Icon, value, delta }) => {
        const isUp = delta?.trend === "up";

        return (
          <div
            key={key}
            className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {label}
              </span>
              <Icon className="size-3.5 text-muted-foreground" />
            </div>
            <div className="rounded-md border bg-card p-3 flex items-center justify-between">
              <span className="text-2xl font-semibold tracking-tight">
                {value}
              </span>
              <div className="flex items-center gap-1">
                {delta?.trend === "up" && (
                  <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                {delta?.trend === "down" && (
                  <TrendingDown className="size-3.5 text-destructive" />
                )}
                <span
                  className={cn(
                    "text-sm font-medium",
                    delta?.trend === undefined
                      ? "text-muted-foreground"
                      : isUp
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                  )}
                >
                  {delta ? delta.text : "—"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

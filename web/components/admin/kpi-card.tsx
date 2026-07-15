import * as React from "react";
import Link from "next/link";

import { AppIcon } from "@/components/ui/app-icon";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The dashboard's KPI tile, reused verbatim on the admin surface: a
 * category-colored AppIcon, a big mono value, and a bordered foot line for
 * context or a warm-accent trailing figure. Kept in lockstep with
 * DashboardClient's KpiCard so the two surfaces read as one system.
 */
export function AdminKpiCard({
  color,
  icon,
  title,
  value,
  foot,
  footLink,
  trail,
  tone,
}: {
  color: "green" | "orange" | "blue" | "navy" | "purple";
  icon: React.ReactNode;
  title: string;
  value: string;
  foot?: string;
  footLink?: { href: string; label: string };
  trail?: string;
  tone?: "warn";
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AppIcon color={color}>{icon}</AppIcon>
            <span className="text-sm font-medium text-muted-foreground">
              {title}
            </span>
          </div>
        </div>
        <p
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums tracking-tight",
            tone === "warn" ? "text-brand" : "text-foreground",
          )}
        >
          {value}
        </p>
        <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
          {footLink ? (
            <Link className="text-brand hover:underline" href={footLink.href}>
              {footLink.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{foot ?? " "}</span>
          )}
          {trail && (
            <span
              className={cn(
                "font-mono tabular-nums",
                tone === "warn" ? "text-brand" : "text-muted-foreground",
              )}
            >
              {trail}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

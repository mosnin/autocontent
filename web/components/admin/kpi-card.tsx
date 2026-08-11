import * as React from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The dashboard's KPI tile, reused verbatim on the admin surface: a
 * big mono value and a bordered foot line for context or a trailing figure.
 * A "warn" tone paints the value and trail with the semantic warning token
 * (amber) — reserved for out-of-range metrics like failures or suspensions,
 * kept distinct from the brand accent.
 */
export function AdminKpiCard({
  color: _color,
  title,
  value,
  foot,
  footLink,
  trail,
  tone,
}: {
  color: "green" | "orange" | "blue" | "navy" | "purple";
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
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
        <p
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums tracking-tight",
            tone === "warn" ? "text-warning" : "text-foreground",
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
                tone === "warn" ? "text-warning" : "text-muted-foreground",
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

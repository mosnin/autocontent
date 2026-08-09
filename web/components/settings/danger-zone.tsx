import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface DangerZoneProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// A destructive-accented Card for irreversible actions. Mirrors the
// success-card styling used elsewhere (border-*/40 bg-*/5) but in the
// destructive palette so the danger reads at a glance.
export function DangerZone({
  title,
  description,
  children,
  className,
}: DangerZoneProps) {
  return (
    <Card
      className={cn("border-destructive/40 bg-destructive/5", className)}
    >
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

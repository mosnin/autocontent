import * as React from "react";

import { Body, Title } from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * The accent-ruled aside (`os-callout`) used to state a limit out loud —
 * what a pipeline refuses to do, or what it will never charge for. The
 * marketing pages lean on it instead of inventing a "warning" colour.
 */
export function Note({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("os-callout", className)}>
      <Title level={3} size="sm">
        {title}
      </Title>
      <Body className="os-mt-8">{children}</Body>
    </div>
  );
}

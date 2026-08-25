import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Cortex-style pill CTA: inverted fill for primary, hairline for secondary.
 */
export function CtaPill({
  href,
  children,
  variant = "primary",
  className,
  size = "md",
  style,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  size?: "md" | "lg";
  style?: React.CSSProperties;
}) {
  return (
    <Link
      className={cn(
        "focus-ring inline-flex items-center justify-center rounded-full text-sm font-medium transition-opacity",
        size === "lg" ? "h-13 px-8" : "h-11 px-6",
        variant === "primary"
          ? "bg-foreground text-background hover:opacity-85"
          : "border-border text-foreground hover:bg-muted border",
        className,
      )}
      href={href}
      style={style}
    >
      {children}
    </Link>
  );
}

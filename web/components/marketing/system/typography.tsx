import * as React from "react";

import { cn } from "@/lib/utils";

/** Tiny uppercase label used in menus and legal nav — never a colored kicker. */
export function Kicker({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground text-[11px] font-medium tracking-wider uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Display heading matching the Cortex section title: medium weight,
 * tight tracking, clamp scale.
 */
export function DisplayHeading({
  children,
  className,
  level = 2,
  size = "lg",
}: {
  children: React.ReactNode;
  className?: string;
  level?: 1 | 2 | 3;
  size?: "xl" | "lg" | "md";
}) {
  const Tag = (`h${level}`) as "h1" | "h2" | "h3";
  return (
    <Tag
      className={cn(
        "text-foreground font-medium tracking-tight text-balance",
        size === "xl" &&
          "text-[clamp(44px,7.5vw,84px)] leading-[1.02]",
        size === "lg" &&
          "text-[clamp(30px,4.5vw,52px)] leading-[1.05]",
        size === "md" && "text-2xl leading-tight md:text-3xl",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** One-to-two sentence standfirst under a heading. */
export function Lede({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground max-w-xl text-base leading-relaxed",
        className,
      )}
    >
      {children}
    </p>
  );
}

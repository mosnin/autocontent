import * as React from "react";

import { cn } from "@/lib/utils";

/** 11px uppercase eyebrow line above headings. */
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
        "text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Display heading in the site's display face, tight tracking, ink color.
 * `level` controls the tag (exactly one h1 per page); `size` the scale.
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
        "font-display font-semibold tracking-tight text-balance text-zinc-900",
        size === "xl" && "text-5xl leading-[1.02] md:text-6xl lg:text-7xl",
        size === "lg" && "text-4xl leading-[1.05] md:text-5xl",
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
        "max-w-xl text-[17px] leading-relaxed text-zinc-600",
        className,
      )}
    >
      {children}
    </p>
  );
}

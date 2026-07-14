import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

function ArrowCircle({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      <svg
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </span>
  );
}

/**
 * The site's pill CTA. Primary is the ink pill with a trailing arrow-circle
 * glyph (like the reference "Try live demo" button); secondary is a white
 * hairline pill.
 */
export function CtaPill({
  href,
  children,
  variant = "primary",
  className,
  size = "md",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  size?: "md" | "lg";
}) {
  if (variant === "primary") {
    return (
      <Link
        className={cn(
          "group inline-flex min-h-11 items-center gap-3 rounded-full bg-zinc-900 text-sm font-medium text-white shadow-[0_2px_12px_rgba(15,23,42,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-[0_6px_20px_rgba(15,23,42,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
          size === "lg" ? "py-2 pl-7 pr-2 text-[15px]" : "py-1.5 pl-6 pr-1.5",
          className,
        )}
        href={href}
      >
        {children}
        <ArrowCircle className="bg-white/15 text-white transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    );
  }

  return (
    <Link
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border border-zinc-900/10 bg-white text-sm font-medium text-zinc-900 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-900/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        size === "lg" ? "px-7 py-2 text-[15px]" : "px-6 py-1.5",
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

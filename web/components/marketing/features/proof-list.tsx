import * as React from "react";

import { cn } from "@/lib/utils";

/** Compact checked bullet list used as "proof" under feature ledes. */
export function ProofList({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3.5", className)}>
      {items.map((item) => (
        <li
          className="flex items-start gap-3 text-[15px] leading-relaxed text-zinc-600"
          key={item}
        >
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-zinc-900/[0.08] bg-white text-zinc-700"
          >
            <svg
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

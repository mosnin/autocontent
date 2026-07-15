import * as React from "react";

import { warmDot } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * Compact bullet list used as "proof" under feature ledes. Bullets are
 * warm pass-dots (Amendment 2), never an icon glyph.
 */
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
            className={cn("mt-[9px] size-1.5 shrink-0 rounded-full", warmDot)}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

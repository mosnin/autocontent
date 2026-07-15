import * as React from "react";

import { cn } from "@/lib/utils";

const DEFAULT_NAMES = [
  "Northbeam Studio",
  "Halide Labs",
  "Fern & Field",
  "Copperline",
  "Arcadia Supply",
  "Moonrise Coffee",
];

/**
 * Quiet text-mark "trusted by" row. Generic team names, never real
 * trademarked brands.
 */
export function LogoRow({
  className,
  label = "Trusted by teams shipping daily",
  names = DEFAULT_NAMES,
}: {
  className?: string;
  label?: string;
  names?: string[];
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
        {label}
      </p>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {names.map((name) => (
          <li
            className="whitespace-nowrap font-display text-sm font-semibold tracking-tight text-zinc-400/90"
            key={name}
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

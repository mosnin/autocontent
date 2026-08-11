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
    <div className={cn("os-stack os-gap-16", className)}>
      <p className="os-label">{label}</p>
      <ul className="os-logos">
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

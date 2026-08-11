import * as React from "react";

import { Bullets } from "@/components/site/sections";

/**
 * Compact bullet list used as "proof" under feature ledes. Bullets are the
 * accent's small square marks, never an icon glyph.
 */
export function ProofList({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  return <Bullets className={className} items={items} />;
}

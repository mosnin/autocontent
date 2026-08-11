import * as React from "react";

import { Stage } from "@/components/site/sections";
import type { VignetteScene } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * Band-side frame for a product miniature: the same hairline stage the
 * homepage puts its screenshots in, so band mocks read in the card
 * language. `scene` is kept for call-site compatibility.
 */
export function VignetteStage({
  scene: _scene = "pearl",
  className,
  children,
}: {
  scene?: VignetteScene;
  className?: string;
  children: React.ReactNode;
}) {
  return <Stage className={cn("os-full", className)}>{children}</Stage>;
}

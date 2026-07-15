import * as React from "react";

import {
  VIGNETTE_SCENES,
  type VignetteScene,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * Band-side vignette frame (Amendment 2 anatomy, outside a card grid):
 * stages a product miniature on a soft scene wash with the inner
 * hairline, so band mocks read in the same card language as
 * `<VignetteCard>` vignettes.
 */
export function VignetteStage({
  scene = "pearl",
  className,
  children,
}: {
  scene?: VignetteScene;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full max-w-md items-center justify-center rounded-2xl p-6 ring-1 ring-inset ring-zinc-900/[0.05] sm:p-8",
        VIGNETTE_SCENES[scene],
        className,
      )}
    >
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}

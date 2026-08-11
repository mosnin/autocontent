import * as React from "react";

import { Btn } from "@/components/site/sections";

/**
 * The site's call-to-action button. The transcribed export's CTAs are square
 * mono-uppercase blocks, not pills — the nav's "START FREE" is the reference
 * — so this now renders `<Btn>` from the section primitives. The prop shape
 * is unchanged so every existing call site keeps working.
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
  return (
    <Btn className={className} href={href} size={size} variant={variant}>
      {children}
    </Btn>
  );
}

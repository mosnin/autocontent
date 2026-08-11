import * as React from "react";

import { VignetteCard, type VignetteScene } from "@/components/marketing/system";
import { CardLink } from "@/components/site/sections";

/**
 * Resources-hub card: a product miniature staged on the hairline frame,
 * category eyebrow + title + one-liner below, and the quiet mono "Read"
 * arrow pinned to the bottom. The whole card is a link.
 */
export function ResourceCard({
  category,
  title,
  description,
  href,
  vignette,
  scene = "pearl",
  className,
}: {
  category: string;
  title: string;
  description: string;
  href: string;
  /** A miniature from the vignette library (or a local resources mini). */
  vignette: React.ReactNode;
  scene?: VignetteScene;
  className?: string;
}) {
  return (
    <VignetteCard
      className={className}
      description={description}
      footer={<CardLink>Read</CardLink>}
      href={href}
      kicker={category}
      scene={scene}
      title={title}
      vignette={vignette}
    />
  );
}

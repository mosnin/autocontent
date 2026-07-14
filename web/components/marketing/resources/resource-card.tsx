import * as React from "react";

import {
  VignetteCard,
  type VignetteScene,
} from "@/components/marketing/system";

/**
 * Resources-hub card in the vignette language (Amendment 2): a product
 * miniature staged on a scene wash up top, kicker category + title +
 * one-liner below, and a quiet "Read" arrow pinned to the bottom. The
 * whole card is a link with the shared hover lift. Never an icon.
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
      footer={
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900">
          Read
          <svg
            aria-hidden
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
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
      }
      href={href}
      kicker={category}
      scene={scene}
      title={title}
      vignette={vignette}
    />
  );
}

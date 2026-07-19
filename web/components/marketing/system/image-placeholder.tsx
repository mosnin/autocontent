import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Labeled placeholder frame for imagery that will be uploaded later
 * (product screenshots, photos, partner logos). Renders a soft checkered
 * panel with the expected filename so swapping in the real asset is a
 * one-line change: replace this element with an <Image src=…>.
 */
export function ImagePlaceholder({
  label,
  file,
  className,
  aspect = "aspect-[16/10]",
}: {
  /** Human description of what goes here, e.g. "App screenshot — Studio queue". */
  label: string;
  /** Suggested filename to upload, e.g. "hero-app.png". */
  file: string;
  className?: string;
  /** Tailwind aspect class; ignored if the parent sizes the frame. */
  aspect?: string;
}) {
  return (
    <div
      aria-label={`Image placeholder: ${label}`}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-zinc-900/15 bg-[linear-gradient(135deg,#fafafa,#f1f3f7)] text-center",
        aspect,
        className,
      )}
      role="img"
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-[0.4] [background-image:linear-gradient(45deg,rgba(15,23,42,0.03)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.03)_75%),linear-gradient(45deg,rgba(15,23,42,0.03)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.03)_75%)] [background-position:0_0,12px_12px] [background-size:24px_24px]"
      />
      <svg
        aria-hidden
        className="relative size-7 text-zinc-300"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <rect height="16" rx="3" width="20" x="2" y="4" />
        <circle cx="8.5" cy="10" r="1.75" />
        <path d="m22 16-4.5-4.5L11 18l-3-3-6 5" />
      </svg>
      <span className="relative px-6 text-[13px] font-medium text-zinc-500">
        {label}
      </span>
      <span className="relative rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-0.5 font-mono text-[11px] text-zinc-400">
        upload: {file}
      </span>
    </div>
  );
}

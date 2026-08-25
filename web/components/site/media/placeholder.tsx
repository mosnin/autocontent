/**
 * The placeholder that stands in for a showcase asset that has not landed
 * yet, plus the frame both it and real media share.
 *
 * It is deliberately *designed*, not a broken-image state: the export's own
 * unfilled-media treatment (surface, faint accent dot-matrix, corner wash)
 * with the three facts you need in order to fill it - what kind of asset
 * belongs here, at what size and format, and the exact path to drop the file
 * at. Every value comes from the `--os-*` tokens, so it reads as part of the
 * page rather than as scaffolding.
 *
 * No `"use client"`: this renders on the server, including inside the client
 * video component.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  SHOWCASE_KINDS,
  aspectLabel,
  type ShowcaseAspect,
  type ShowcaseKind,
} from "./showcase.config";

import "./showcase.css";

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */

/**
 * The corner-ticked box every slot lives in, at a reserved aspect ratio.
 *
 * The ticks are the same signature `Frame` draws in the section primitives;
 * they are inlined here rather than composed so the frame can also clip its
 * media (`overflow: hidden`) without a second wrapper element.
 */
export function SlotFrame({
  aspect,
  dense = false,
  title,
  note,
  children,
  className,
}: {
  aspect: ShowcaseAspect;
  /** Tighter placeholder padding, for narrow (portrait/vertical) slots. */
  dense?: boolean;
  /** Caption under the frame. Omit both to render the frame alone. */
  title?: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("ms-slot", dense && "ms-slot--dense", className)}>
      <div className="os-frame ms-slot__frame">
        <span aria-hidden className="os-tick os-tick--tl" />
        <span aria-hidden className="os-tick os-tick--tr" />
        <span aria-hidden className="os-tick os-tick--bl" />
        <span aria-hidden className="os-tick os-tick--br" />
        <div
          className="ms-slot__box"
          style={{ "--ms-aspect": aspect } as React.CSSProperties}
        >
          {children}
        </div>
      </div>
      {title || note ? (
        <figcaption className="ms-slot__caption">
          {title ? <p className="ms-slot__title">{title}</p> : null}
          {note ? <p className="ms-slot__note">{note}</p> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function StillIcon() {
  return (
    <svg
      aria-hidden
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="16" rx="1.5" width="18" x="3" y="4" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5a1.5 1.5 0 0 1 2 0L15 17" />
      <path d="m14 15 1.7-1.7a1.5 1.5 0 0 1 2 0L20 15.5" />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg
      aria-hidden
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="16" rx="1.5" width="18" x="3" y="4" />
      <path d="M10.4 9.3v5.4l4.4-2.7z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Placeholder                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fills a `SlotFrame` when no file is wired up.
 *
 * `role="img"` + `aria-label` means a screen reader hears one sentence
 * naming the missing asset rather than spelling out the file path, while
 * sighted users get the path they need. Nothing is conveyed by colour: the
 * badge always carries its word.
 */
export function SlotPlaceholder({
  kind,
  aspect,
  dimensions,
  formats,
  path,
  alt,
  posterPath,
}: {
  kind: ShowcaseKind;
  aspect: ShowcaseAspect;
  dimensions: string;
  formats: string;
  /** Public URL the real file is expected at, e.g. `/showcase/ads/x.jpg`. */
  path: string;
  /** What the finished asset will show - the accessible label. */
  alt: string;
  /** Video only: where the poster frame goes. */
  posterPath?: string;
}) {
  const meta = SHOWCASE_KINDS[kind];
  const isVideo = meta.medium === "video";

  return (
    <div
      aria-label={`Placeholder for ${meta.badge.toLowerCase()}: ${alt} Add the file at public${path}.`}
      className="ms-ph"
      data-showcase-placeholder={kind}
      role="img"
    >
      <span className="ms-ph__icon">
        {isVideo ? <ClipIcon /> : <StillIcon />}
      </span>
      <span className="ms-ph__badge">{meta.badge}</span>
      <p className="ms-ph__spec">
        {dimensions} · {aspectLabel(aspect)} · {formats}
      </p>
      <p className="ms-ph__path">
        {`public${path}`}
        {posterPath ? (
          <>
            <br />
            {`+ poster public${posterPath}`}
          </>
        ) : null}
      </p>
    </div>
  );
}

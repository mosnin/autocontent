/**
 * Layouts for several showcase slots at once, plus the registry-driven
 * renderer that turns a slot declaration into the right component.
 *
 * All server components: a page of unfilled slots ships no JavaScript at
 * all, because `ShowcaseSlot` only reaches for the client video player when
 * a clip is actually wired up.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

import { ShowcaseImage } from "./showcase-image";
import { ShowcaseVideo } from "./showcase-video";
import { SlotFrame, SlotPlaceholder } from "./placeholder";
import {
  SHOWCASE_KINDS,
  expectedPath,
  expectedPosterPath,
  type ShowcaseSlot as Slot,
} from "./showcase.config";

import "./showcase.css";

/* ------------------------------------------------------------------ */
/* Registry -> component                                               */
/* ------------------------------------------------------------------ */

/**
 * Renders one registry entry. This is the only place that knows how a slot's
 * `kind` maps to a component, which is what keeps swapping in real media a
 * config-only edit.
 */
export function ShowcaseSlot({
  slot,
  dense,
  priority,
  sizes,
  showCaption = true,
  className,
}: {
  slot: Slot;
  dense?: boolean;
  priority?: boolean;
  sizes?: string;
  showCaption?: boolean;
  className?: string;
}) {
  const path = expectedPath(slot);
  const caption = showCaption
    ? { title: slot.title, note: slot.note }
    : { title: undefined, note: undefined };

  if (SHOWCASE_KINDS[slot.kind].medium === "image") {
    return (
      <ShowcaseImage
        alt={slot.alt}
        aspect={slot.aspect}
        className={className}
        dense={dense}
        dimensions={slot.dimensions}
        formats={slot.formats}
        kind={slot.kind}
        note={caption.note}
        path={path}
        priority={priority}
        sizes={sizes}
        src={slot.src}
        title={caption.title}
      />
    );
  }

  const posterPath = expectedPosterPath(slot);

  // No clip yet? Render the placeholder from the server and skip the client
  // player entirely - an empty showcase costs zero JavaScript.
  if (!slot.src) {
    return (
      <SlotFrame
        aspect={slot.aspect}
        className={className}
        dense={dense}
        note={caption.note}
        title={caption.title}
      >
        <SlotPlaceholder
          alt={slot.alt}
          aspect={slot.aspect}
          dimensions={slot.dimensions}
          formats={slot.formats}
          kind={slot.kind}
          path={path}
          posterPath={posterPath}
        />
      </SlotFrame>
    );
  }

  return (
    <ShowcaseVideo
      alt={slot.alt}
      aspect={slot.aspect}
      className={className}
      dense={dense}
      dimensions={slot.dimensions}
      formats={slot.formats}
      kind={slot.kind}
      note={caption.note}
      path={path}
      poster={slot.poster}
      posterPath={posterPath}
      src={slot.src}
      title={caption.title}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layouts                                                             */
/* ------------------------------------------------------------------ */

/** Even grid of slots. Collapses 3/4 -> 2 -> 1 on the site's breakpoints. */
export function ShowcaseGrid({
  slots,
  cols = 3,
  dense,
  sizes,
  className,
  children,
}: {
  /** Registry entries to render. Omit and pass `children` to compose freely. */
  slots?: Slot[];
  cols?: 2 | 3 | 4;
  dense?: boolean;
  sizes?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("ms-grid", `ms-grid--${cols}`, className)}>
      {slots?.map((slot) => (
        <ShowcaseSlot dense={dense} key={slot.id} sizes={sizes} slot={slot} />
      ))}
      {children}
    </div>
  );
}

/**
 * Horizontally scrolling row - how the vertical formats (UGC, micro-drama,
 * motion) are staged. It scrolls inside its own box, so the page itself
 * never gains a horizontal scrollbar however narrow the viewport is.
 */
export function ShowcaseRail({
  slots,
  label,
  hint = "Scroll",
  dense = true,
  sizes = "(max-width: 719px) 68vw, (max-width: 1023px) 46vw, 25vw",
  className,
  children,
}: {
  slots?: Slot[];
  /** Optional mono row label rendered above the rail. */
  label?: string;
  hint?: string;
  dense?: boolean;
  sizes?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const railId = label
    ? `ms-rail-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    : undefined;

  return (
    <div className={className}>
      {label ? (
        <div className="ms-rowhead">
          <p className="os-label" id={railId ? `${railId}-label` : undefined}>
            {label}
          </p>
          <span className="ms-hint">
            {hint}
            <svg
              aria-hidden
              fill="none"
              height="11"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              width="11"
            >
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </span>
        </div>
      ) : null}
      {/* tabIndex makes the overflow box scrollable from the keyboard. */}
      <div
        aria-labelledby={railId ? `${railId}-label` : undefined}
        className="ms-rail"
        role="group"
        tabIndex={0}
      >
        {slots?.map((slot) => (
          <ShowcaseSlot dense={dense} key={slot.id} sizes={sizes} slot={slot} />
        ))}
        {children}
      </div>
    </div>
  );
}

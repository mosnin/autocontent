/**
 * A still generated on the platform - an ad creative, a key frame, a render.
 *
 * Server component. The box reserves its aspect ratio before the image
 * loads, so nothing on the page moves when it arrives, and `alt` is a
 * required prop: an ad still that says nothing to a screen reader is a bug,
 * not a nicety.
 *
 * With no `src`, the same frame renders the placeholder instead.
 */
import * as React from "react";
import Image from "next/image";

import { SlotFrame, SlotPlaceholder } from "./placeholder";
import type { ShowcaseAspect, ShowcaseKind } from "./showcase.config";

export function ShowcaseImage({
  src,
  alt,
  aspect,
  kind = "ad",
  dimensions,
  formats,
  path,
  title,
  note,
  dense,
  priority = false,
  sizes = "(max-width: 719px) 100vw, (max-width: 1023px) 50vw, 33vw",
  className,
}: {
  /** Public URL of the real file. Absent -> placeholder. */
  src?: string | null;
  /** Required. What the image shows, for anyone who cannot see it. */
  alt: string;
  aspect: ShowcaseAspect;
  kind?: ShowcaseKind;
  /** Intended pixel size, shown on the placeholder. */
  dimensions: string;
  /** Accepted formats, shown on the placeholder. */
  formats: string;
  /** Where the file belongs, shown on the placeholder. */
  path: string;
  title?: string;
  note?: string;
  dense?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <SlotFrame
      aspect={aspect}
      className={className}
      dense={dense}
      note={note}
      title={title}
    >
      {src ? (
        <Image
          alt={alt}
          className="ms-slot__media"
          fill
          priority={priority}
          sizes={sizes}
          src={src}
        />
      ) : (
        <SlotPlaceholder
          alt={alt}
          aspect={aspect}
          dimensions={dimensions}
          formats={formats}
          kind={kind}
          path={path}
        />
      )}
    </SlotFrame>
  );
}

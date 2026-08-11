import * as React from "react";

import { MediaSlot } from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * Tagged media placeholder: the dark surface with a whisper of the accent
 * dot-matrix and one mono tag naming what belongs there. No fake art — it
 * reads as "media goes here" and nothing else. The parent sizes the frame
 * (aspect + rounding + overflow-hidden), so swapping in the real asset is a
 * one-element change.
 */

type Kind = "video" | "image" | "illustration";
/** Kept for call-site compatibility; the dark ground has one wash. */
type Tone = "warm" | "sky" | "violet" | "slate" | "rose";

export function TaggedPlaceholder({
  kind,
  label,
  tone: _tone = "slate",
  className,
}: {
  kind: Kind;
  /** What belongs here, e.g. "Feature demo — script to render". */
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return <MediaSlot className={cn(className)} kind={kind} label={label} />;
}

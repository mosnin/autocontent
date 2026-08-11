import * as React from "react";

import { MediaSlot } from "@/components/site/sections";

/**
 * A media slot that fills a `<VignetteCard>`'s staged frame edge to edge.
 * The frame is `position: relative` with its own padding, so an absolutely
 * positioned child covers it exactly.
 */
export function StageMedia({
  kind,
  label,
}: {
  kind: "video" | "image" | "illustration";
  label: string;
}) {
  return <MediaSlot className="os-vfill" kind={kind} label={label} />;
}

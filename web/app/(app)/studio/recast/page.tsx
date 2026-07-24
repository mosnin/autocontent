"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function RecastStudio() {
  return (
    <StudioSurface
      blurb="Re-perform a video with a different character."
      emptyHint="Your recast clip appears here."
      kind="recast"
      promptPlaceholder="Optional direction for the recast"
      referenceSlots={[
        {
          param: "video_url",
          label: "Source video",
          accept: "video/mp4,video/quicktime,video/webm",
          required: true,
        },
        {
          param: "image_url",
          label: "Character",
          accept: "image/png,image/jpeg,image/webp",
          required: true,
        },
      ]}
      title="Recast"
    />
  );
}

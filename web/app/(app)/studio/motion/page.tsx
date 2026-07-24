"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function MotionStudio() {
  return (
    <StudioSurface
      blurb="Restyle, upscale, or re-time a clip you already have."
      emptyHint="Your processed clip appears here."
      kind="video2video"
      promptPlaceholder="Optional direction for the edit"
      referenceSlots={[
        {
          param: "video_url",
          label: "Source video",
          accept: "video/mp4,video/quicktime,video/webm",
          required: true,
        },
      ]}
      title="Motion"
    />
  );
}

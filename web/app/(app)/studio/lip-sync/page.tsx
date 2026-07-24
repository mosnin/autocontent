"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function LipSyncStudio() {
  return (
    <StudioSurface
      blurb="Match a performance to a voice track."
      emptyHint="Your synced clip appears here."
      kind="lipsync"
      promptPlaceholder="Optional direction for the performance"
      referenceSlots={[
        {
          param: "video_url",
          label: "Source video",
          accept: "video/mp4,video/quicktime,video/webm",
          required: true,
        },
        {
          param: "audio_url",
          label: "Voice track",
          accept: "audio/mpeg,audio/wav,audio/mp4",
          required: true,
        },
      ]}
      title="Lip sync"
    />
  );
}

"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function VideoStudio() {
  return (
    <StudioSurface
      blurb="Generate a clip from a description, or animate a still you attach."
      emptyHint="Your clip appears here."
      kind="video"
      promptPlaceholder="Describe the shot: subject, motion, camera"
      referenceSlots={[
        {
          param: "image_url",
          label: "First frame",
          accept: "image/png,image/jpeg,image/webp",
        },
        {
          param: "last_image",
          label: "Last frame",
          accept: "image/png,image/jpeg,image/webp",
        },
      ]}
      title="Video"
    />
  );
}

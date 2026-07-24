"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function CinemaStudio() {
  return (
    <StudioSurface
      blurb="Longer-form shots: write the scene, set the length, and render it."
      emptyHint="Your scene appears here."
      kind="video"
      promptLabel="Scene"
      promptPlaceholder="Scene, characters, action, camera, lighting"
      referenceSlots={[
        {
          param: "image_url",
          label: "Establishing frame",
          accept: "image/png,image/jpeg,image/webp",
        },
      ]}
      title="Cinema"
    />
  );
}

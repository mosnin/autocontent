"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function ImageStudio() {
  return (
    <StudioSurface
      blurb="Generate a still from a description, or from reference images."
      emptyHint="Your image appears here."
      kind="image"
      promptPlaceholder="Describe the image"
      referenceSlots={[
        {
          param: "images_list",
          label: "Reference images",
          accept: "image/png,image/jpeg,image/webp",
          max: 4,
        },
      ]}
      title="Image"
    />
  );
}

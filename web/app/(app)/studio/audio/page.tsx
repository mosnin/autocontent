"use client";

import { StudioSurface } from "@/components/studio/studio-surface";

export default function AudioStudio() {
  return (
    <StudioSurface
      blurb="Speech and music from text."
      emptyHint="Your audio appears here."
      kind="audio"
      promptLabel="Script"
      promptParam="text"
      promptPlaceholder="What should be said, or the music you want"
      title="Audio"
    />
  );
}

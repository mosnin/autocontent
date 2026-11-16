// Markup idea from livekit-examples/agent-starter-react `components/agents-ui/agent-audio-visualizer-bar.tsx`
// (Agents UI, Apache-2.0 / MIT, Copyright (c) 2025 LiveKit, Inc.; see ./THIRD_PARTY_NOTICES.md).
// Re-implemented for Agent Starter with `--as-*` tokens (no cva/Tailwind); the band normalization is ours.
import { type TrackReferenceOrPlaceholder, useMultibandTrackVolume } from "@livekit/components-react";
import { type VoiceAgentState, useBarAnimator } from "./use-bar-animator.ts";

/** Resize per-band volumes to exactly `count` values (pad with the last value). */
export function normalizeBands(bands: number[], count: number): number[] {
  if (bands.length >= count) return bands.slice(0, count);
  const last = bands.at(-1) ?? 0;
  return [...bands, ...Array.from({ length: count - bands.length }, () => last)];
}

export interface VoiceVisualizerProps {
  state: VoiceAgentState | undefined;
  /** The agent's audio track (from `useAgent().microphoneTrack`). */
  track?: TrackReferenceOrPlaceholder;
  barCount?: number;
  label?: string;
}

/** State-driven bar visualizer colored from `--as-color-accent`. */
export function VoiceVisualizer({ state, track, barCount = 5, label = "Agent audio" }: VoiceVisualizerProps) {
  const volumes = normalizeBands(useMultibandTrackVolume(track, { bands: barCount, loPass: 100, hiPass: 200 }), barCount);
  const highlighted = useBarAnimator(state, barCount, state === "connecting" || state === "initializing" ? 2000 / barCount : 300);
  return (
    <div className="as-voice-visualizer" role="img" aria-label={`${label}: ${state ?? "idle"}`} data-state={state ?? "idle"}>
      {volumes.map((volume, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
          key={index}
          className="as-voice-bar"
          data-highlighted={highlighted.includes(index) ? "true" : "false"}
          style={{ height: `${Math.round(14 + Math.min(1, Math.max(0, state === "speaking" ? volume : 0)) * 58)}px` }}
        />
      ))}
    </div>
  );
}

/*
 * Adapted from livekit-examples/agent-starter-react `hooks/agents-ui/use-agent-audio-visualizer-bar.ts`
 * (commit 9e1fc2f), which originates in LiveKit's Agents UI registry
 * (livekit/components-js `packages/shadcn`).
 *
 * Copyright 2025 LiveKit, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing
 * permissions and limitations under the License. Also redistributed by LiveKit under the MIT License
 * (Copyright (c) 2025 LiveKit, Inc.); see ./THIRD_PARTY_NOTICES.md.
 *
 * MODIFIED by Agent Starter (Apache-2.0 §4(b)): typed against our own `VoiceAgentState` (no
 * @livekit/components-react type import), pure sequence generators exported for tests, `idle`
 * and `pre-connect-buffering` mapped explicitly, and the animation loop skipped when there is
 * nothing to animate.
 */
import { useEffect, useRef, useState } from "react";

/** Agent states reported by `useAgent()` (mirrors `AgentState` from @livekit/components-react). */
export type VoiceAgentState = "disconnected" | "connecting" | "pre-connect-buffering" | "failed" | "initializing" | "idle" | "listening" | "thinking" | "speaking";

/** Connecting: a pair of bars sweeping in from both edges. */
export function connectingSequence(columns: number): number[][] {
  const sequence: number[][] = [];
  for (let x = 0; x < columns; x++) sequence.push([x, columns - 1 - x]);
  return sequence;
}

/** Listening / thinking: the center bar blinks. */
export function listeningSequence(columns: number): number[][] {
  return [[Math.floor(columns / 2)], [-1]];
}

/** Which bars are highlighted, frame by frame, for an agent state. */
export function barSequence(state: VoiceAgentState | undefined, columns: number): number[][] {
  if (state === "thinking" || state === "listening" || state === "pre-connect-buffering") return listeningSequence(columns);
  if (state === "connecting" || state === "initializing") return connectingSequence(columns);
  if (state === undefined || state === "speaking") return [Array.from({ length: columns }, (_, i) => i)];
  return [[]];
}

/** Highlighted bar indexes for the current animation frame. */
export function useBarAnimator(state: VoiceAgentState | undefined, columns: number, interval: number): number[] {
  const [index, setIndex] = useState(0);
  const sequence = barSequence(state, columns);
  const animated = sequence.length > 1;

  useEffect(() => {
    setIndex(0);
  }, [state, columns]);

  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!animated || typeof requestAnimationFrame === "undefined") return;
    let start = performance.now();
    const animate = (time: number) => {
      if (time - start >= interval) {
        setIndex((previous) => previous + 1);
        start = time;
      }
      frame.current = requestAnimationFrame(animate);
    };
    frame.current = requestAnimationFrame(animate);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [interval, animated, state, columns]);

  return sequence[index % sequence.length] ?? [];
}

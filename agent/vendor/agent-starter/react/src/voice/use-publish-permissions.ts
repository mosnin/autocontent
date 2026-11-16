// Adapted from livekit-examples/agent-starter-embed `hooks/use-publish-permissions.ts` (commit 1cb7223).
// MIT License, Copyright (c) 2025 LiveKit, Inc. See ./THIRD_PARTY_NOTICES.md for the full notice.
// Changes: pure `publishPermissions()` helper split out for tests.
import { useLocalParticipantPermissions } from "@livekit/components-react";

export interface PublishPermissions {
  camera: boolean;
  microphone: boolean;
  screenShare: boolean;
  data: boolean;
}

// Protocol TrackSource numbers (avoids importing @livekit/protocol into the bundle).
const CAMERA = 1;
const MICROPHONE = 2;
const SCREEN_SHARE = 3;

/** Map the participant token's grants to UI capabilities (the Worker sets them from tenant policy). */
export function publishPermissions(permissions: { canPublish?: boolean; canPublishSources?: number[]; canPublishData?: boolean } | undefined): PublishPermissions {
  const can = (source: number) => Boolean(permissions?.canPublish) && ((permissions?.canPublishSources?.length ?? 0) === 0 || Boolean(permissions?.canPublishSources?.includes(source)));
  return { camera: can(CAMERA), microphone: can(MICROPHONE), screenShare: can(SCREEN_SHARE), data: permissions?.canPublishData ?? false };
}

export function usePublishPermissions(): PublishPermissions {
  return publishPermissions(useLocalParticipantPermissions() as Parameters<typeof publishPermissions>[0]);
}

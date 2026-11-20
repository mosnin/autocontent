/**
 * @agent-starter/react/voice — voice UI for the opt-in `voice` module (LiveKit).
 *
 * Needs the optional peers `livekit-client` and `@livekit/components-react`; chat-only apps that
 * never import this entry do not need them. Calls connect through the Worker's `/voice/sessions`
 * (session-token auth, tenant and budget decided server-side), never with a client-chosen room,
 * agent or tenant.
 */
export { APPROVAL_PENDING_ATTRIBUTE, VoiceSession } from "./VoiceSession.tsx";
export type { VoiceCallRenderProps, VoiceSessionProps } from "./VoiceSession.tsx";
export { createVoiceTokenSource, requestVoiceSession, useVoiceSession, VoiceSessionError } from "./use-voice-session.ts";
export type { UseVoiceSessionOptions, UseVoiceSessionResult, VoiceConnectionDetails, VoiceConsentInput, VoiceSessionRequestOptions } from "./use-voice-session.ts";
export { mountVoiceWidget } from "./mount-voice-widget.tsx";
export type { MountedVoiceWidget, MountVoiceWidgetOptions } from "./mount-voice-widget.tsx";
export { normalizeBands, VoiceVisualizer } from "./VoiceVisualizer.tsx";
export type { VoiceVisualizerProps } from "./VoiceVisualizer.tsx";
export { barSequence, useBarAnimator } from "./use-bar-animator.ts";
export type { VoiceAgentState } from "./use-bar-animator.ts";
export { publishPermissions, usePublishPermissions } from "./use-publish-permissions.ts";
export type { PublishPermissions } from "./use-publish-permissions.ts";
export { useVoiceErrors } from "./use-voice-errors.ts";
export { safeHexColor, shadowStyles, VOICE_CSS } from "./styles.ts";
export { rememberVoiceVisitor, storedVoiceVisitor } from "./mount-voice-widget.tsx";

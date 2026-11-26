// Composition pattern (session → provider → view switching on connection/agent state) follows
// livekit-examples/agent-starter-react `components/app/app.tsx` and `view-controller.tsx`
// (MIT License, Copyright (c) 2025 LiveKit, Inc.; see ./THIRD_PARTY_NOTICES.md). Re-implemented:
// our token route, consent gate, approvals banner and `--as-*` styling; no motion/Tailwind.
import { RoomAudioRenderer, SessionProvider, StartAudio, useAgent, useSessionMessages, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { VOICE_CSS } from "./styles.ts";
import type { VoiceAgentState } from "./use-bar-animator.ts";
import { usePublishPermissions } from "./use-publish-permissions.ts";
import { useVoiceErrors } from "./use-voice-errors.ts";
import { type UseVoiceSessionOptions, type UseVoiceSessionResult, useVoiceSession, type VoiceConnectionDetails } from "./use-voice-session.ts";
import { VoiceVisualizer } from "./VoiceVisualizer.tsx";

/** Agent participant attribute the voice agent sets while a tool call waits for approval. */
export const APPROVAL_PENDING_ATTRIBUTE = "agent_starter.approval_pending";

export interface VoiceCallRenderProps {
  details: VoiceConnectionDetails | null;
  conversationId: string | undefined;
  end: () => Promise<void>;
}

export interface VoiceSessionProps extends Omit<UseVoiceSessionOptions, "autoStart" | "consent"> {
  title?: string;
  startLabel?: string;
  endLabel?: string;
  /**
   * Recording consent shown before Start. Pass the tenant's consent `version`; the Worker
   * records only when its policy allows it and this version was accepted.
   */
  consent?: { version: string; text?: ReactNode };
  /** Pending approvals on this conversation (e.g. from `useApprovals`/`AgentChat`). Falls back to the agent's attribute. */
  pendingApprovals?: number;
  showTranscript?: boolean;
  /** Bars in the visualizer. Default 5. */
  barCount?: number;
  theme?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
  /** Render the voice CSS in a `<style>` (default true). Turn off if you ship `VOICE_CSS` yourself. */
  injectStyles?: boolean;
  onSessionStart?: (details: VoiceConnectionDetails) => void;
  onEnded?: () => void;
  /** Conversation pane rendered during the call, e.g. `<AgentChat>` on `conversationId` for approvals and history. */
  children?: (call: VoiceCallRenderProps) => ReactNode;
}

const STATUS: Record<VoiceAgentState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  "pre-connect-buffering": "Listening…",
  failed: "The assistant could not join",
  initializing: "Assistant is joining…",
  idle: "Assistant is joining…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

/**
 * Voice call surface: consent gate → Start → live call (visualizer, captions, mute, end,
 * approval-pending state). The call connects through the Worker's `/voice/sessions`, never
 * with a client-chosen room, agent or tenant.
 */
export function VoiceSession(props: VoiceSessionProps) {
  const { title = "Talk to the assistant", startLabel = "Start call", consent, theme, className, style, injectStyles = true } = props;
  const [phase, setPhase] = useState<"idle" | "active">("idle");
  const [accepted, setAccepted] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const consentId = useId();

  return (
    <section className={["as-voice", className].filter(Boolean).join(" ")} style={style} data-theme={theme} aria-label={title}>
      {injectStyles ? <style>{VOICE_CSS}</style> : null}
      <header className="as-voice-header">
        <h2 className="as-voice-title">{title}</h2>
      </header>
      {phase === "idle" ? (
        <>
          {consent ? (
            <label className="as-voice-consent" htmlFor={consentId}>
              <input id={consentId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.currentTarget.checked)} />
              <span>{consent.text ?? "I agree that this call may be recorded and transcribed."}</span>
            </label>
          ) : null}
          {lastError ? (
            <p className="as-voice-error" role="alert">
              {lastError}
            </p>
          ) : ended ? (
            <p className="as-voice-status">Call ended.</p>
          ) : null}
          <div className="as-voice-actions">
            <button
              type="button"
              className="as-voice-button as-voice-button--primary"
              onClick={() => {
                setLastError(null);
                setEnded(false);
                setPhase("active");
              }}
            >
              {startLabel}
            </button>
          </div>
        </>
      ) : (
        <ActiveCall
          {...props}
          consentInput={consent ? { recording: accepted, version: consent.version } : undefined}
          onFinished={(error) => {
            setPhase("idle");
            setEnded(!error);
            setLastError(error);
            props.onEnded?.();
          }}
        />
      )}
    </section>
  );
}

function ActiveCall(props: VoiceSessionProps & { consentInput: { recording: boolean; version: string } | undefined; onFinished: (error: string | null) => void }) {
  const { consentInput, onFinished, onSessionStart, endpoint, token, headers, credentials, agent, resume, body, simpleRequest, fetch, agentConnectTimeoutMilliseconds, notifyEnd } = props;
  const voice = useVoiceSession({
    autoStart: true,
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(credentials !== undefined ? { credentials } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(resume !== undefined ? { resume } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(simpleRequest !== undefined ? { simpleRequest } : {}),
    ...(fetch !== undefined ? { fetch } : {}),
    ...(agentConnectTimeoutMilliseconds !== undefined ? { agentConnectTimeoutMilliseconds } : {}),
    ...(notifyEnd !== undefined ? { notifyEnd } : {}),
    ...(consentInput ? { consent: consentInput } : {}),
    ...(onSessionStart ? { onDetails: onSessionStart } : {}),
  });
  const wasConnected = useRef(false);
  const finished = useRef(false);
  const finish = useRef(onFinished);
  finish.current = onFinished;
  useEffect(() => {
    if (voice.error && !finished.current) {
      finished.current = true;
      finish.current(voice.error.message);
    }
  }, [voice.error]);
  useEffect(() => {
    if (voice.session.isConnected) wasConnected.current = true;
    else if (wasConnected.current && !finished.current) {
      finished.current = true;
      finish.current(null);
    }
  }, [voice.session.isConnected]);

  return (
    <SessionProvider session={voice.session}>
      <RoomAudioRenderer />
      <StartAudio label="Allow audio playback" className="as-voice-button" />
      <CallBody {...props} voice={voice} />
    </SessionProvider>
  );
}

function CallBody({ voice, pendingApprovals, showTranscript = true, barCount = 5, endLabel = "End call", children }: VoiceSessionProps & { voice: UseVoiceSessionResult }) {
  const agent = useAgent();
  const { messages } = useSessionMessages(voice.session);
  const permissions = usePublishPermissions();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const failures = useVoiceErrors();
  const state = agent.state as VoiceAgentState;
  const approvalPending = (pendingApprovals ?? 0) > 0 || agent.attributes?.[APPROVAL_PENDING_ATTRIBUTE] === "true";
  const recording = voice.details?.recording && voice.details.recording !== "off";

  return (
    <>
      <div className="as-voice-header">
        <span className="as-voice-status" aria-live="polite">
          {STATUS[state] ?? state}
        </span>
        {recording ? <span className="as-voice-recording">Recording</span> : null}
      </div>
      <VoiceVisualizer state={state} track={agent.microphoneTrack} barCount={barCount} />
      {approvalPending ? (
        <p className="as-voice-banner" role="status">
          Waiting for approval. The assistant will continue once someone approves or rejects the request.
        </p>
      ) : null}
      {failures.length ? (
        <p className="as-voice-error" role="alert">
          {failures.join(" ")}
        </p>
      ) : null}
      {showTranscript ? (
        <ul className="as-voice-transcript" aria-label="Live transcript">
          {messages.map((message) => {
            const speaker = message.type === "userTranscript" || (message.type !== "agentTranscript" && message.from?.isLocal) ? "user" : "agent";
            return (
              <li key={message.id} className="as-voice-line" data-speaker={speaker}>
                <span className="as-voice-speaker">{speaker === "user" ? "You" : "Assistant"}</span>
                {message.message}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="as-voice-actions">
        <button type="button" className="as-voice-button" disabled={!permissions.microphone || mic.pending} aria-pressed={!mic.enabled} onClick={() => void mic.toggle()}>
          {mic.enabled ? "Mute" : "Unmute"}
        </button>
        <button type="button" className="as-voice-button as-voice-button--danger" onClick={() => void voice.end()}>
          {endLabel}
        </button>
      </div>
      {children?.({ details: voice.details, conversationId: voice.conversationId, end: voice.end })}
    </>
  );
}

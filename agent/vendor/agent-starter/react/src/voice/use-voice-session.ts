import { type UseSessionReturn, useSession } from "@livekit/components-react";
import { TokenSource } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The Worker's `POST /voice/sessions` answer: LiveKit's standard connection details plus our ids. */
export interface VoiceConnectionDetails {
  server_url: string;
  participant_token: string;
  voice_session_id: string;
  conversation_id: string;
  agent: string;
  agent_path: string;
  max_call_seconds: number;
  recording: "off" | "transcript" | "full";
  /** Widget sessions only: the anonymous visitor id and the signed credential that resumes it. */
  visitor_id?: string;
  visitor?: string;
}

export interface VoiceConsentInput {
  recording: boolean;
  version: string;
}

export interface VoiceSessionRequestOptions {
  /** Session endpoint. Default `/voice/sessions` (`/voice/widget/session` for the widget). */
  endpoint?: string;
  /** Agent Starter session token, sent as `Authorization: Bearer`. */
  token?: string;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  /** Which agent to talk to (must be allowed by the Worker). */
  agent?: string;
  /** Continue an existing conversation of the caller. */
  resume?: string;
  consent?: VoiceConsentInput;
  /** Extra body fields (the widget sends `publicKey` and its signed `visitor` credential). Tenant ids are ignored server-side. */
  body?: Record<string, unknown>;
  /** Send a CORS-simple `text/plain` request (no preflight), for cross-origin widgets. */
  simpleRequest?: boolean;
  fetch?: typeof fetch;
}

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again to start a call.",
  VOICE_DISABLED: "Voice is not enabled for your workspace.",
  VOICE_BUDGET_EXHAUSTED: "There is not enough budget left for a call.",
  AGENT_NOT_ALLOWED: "This assistant is not available by voice.",
  ORIGIN_NOT_ALLOWED: "Voice is not enabled on this site.",
  LIVEKIT_UNAVAILABLE: "The voice service is unavailable. Try again shortly.",
  RATE_LIMITED: "Too many calls were started. Try again in a minute.",
  VOICE_CONCURRENCY_LIMIT: "All voice lines are busy. Try again shortly.",
  VOICE_CALLER_CONCURRENCY_LIMIT: "You already have a call in progress.",
};

export class VoiceSessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(MESSAGES[code] ?? `Could not start the call (${code}).`);
    this.name = "VoiceSessionError";
  }
}

/** Ask the Worker for a voice session (room + explicit dispatch + participant token). */
export async function requestVoiceSession(options: VoiceSessionRequestOptions): Promise<VoiceConnectionDetails> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const extra = typeof options.headers === "function" ? await options.headers() : (options.headers ?? {});
  const headers: Record<string, string> = { "content-type": options.simpleRequest ? "text/plain;charset=UTF-8" : "application/json", ...extra };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const body = { ...options.body, ...(options.agent ? { agent: options.agent } : {}), ...(options.resume ? { resume: options.resume } : {}), ...(options.consent ? { consent: options.consent } : {}) };
  const response = await doFetch(options.endpoint ?? "/voice/sessions", { method: "POST", headers, body: JSON.stringify(body), credentials: options.credentials ?? "same-origin" });
  const payload = (await response.json().catch(() => ({}))) as Partial<VoiceConnectionDetails> & { error?: string };
  if (!response.ok || !payload.server_url || !payload.participant_token) throw new VoiceSessionError(response.status, payload.error ?? "INVALID_RESPONSE");
  return payload as VoiceConnectionDetails;
}

/**
 * A LiveKit token source that creates a voice session only when the user starts a call.
 *
 * `useSession()` calls its token source on mount (prepareConnection) and again after a call ends
 * (prefetch). Each request here creates a room, dispatches an agent and passes a budget gate, so
 * requests happen only once armed; concurrent calls share the in-flight request, and later calls
 * reuse the last answer instead of opening a new session.
 */
export function createVoiceTokenSource(request: () => Promise<VoiceConnectionDetails>, onDetails?: (details: VoiceConnectionDetails) => void) {
  let armed = false;
  let pending: Promise<VoiceConnectionDetails> | null = null;
  const source = TokenSource.literal(async () => {
    if (armed) {
      armed = false;
      pending = request().then((details) => {
        onDetails?.(details);
        return details;
      });
      pending.catch(() => {
        pending = null;
      });
    }
    if (!pending) throw new Error("Voice session not started yet");
    const details = await pending;
    return { serverUrl: details.server_url, participantToken: details.participant_token };
  });
  return {
    source,
    arm() {
      armed = true;
      pending = null;
    },
  };
}

export interface UseVoiceSessionOptions extends VoiceSessionRequestOptions {
  /** Start the call as soon as the hook mounts (what `VoiceSession` does after the Start click). */
  autoStart?: boolean;
  /** How long to wait for the agent to join before failing. Default LiveKit's 20 s. */
  agentConnectTimeoutMilliseconds?: number;
  /** POST `${endpoint}/${vsid}/end` on hang-up so the Worker deletes the room at once. Default true when a token is set. */
  notifyEnd?: boolean;
  onDetails?: (details: VoiceConnectionDetails) => void;
  onError?: (error: Error) => void;
}

export interface UseVoiceSessionResult {
  /** The LiveKit session (pass to `<SessionProvider session>`). */
  session: UseSessionReturn;
  details: VoiceConnectionDetails | null;
  voiceSessionId: string | undefined;
  /** The Flue conversation the call runs on: open it with `AgentChat` to show approvals and history. */
  conversationId: string | undefined;
  error: Error | null;
  starting: boolean;
  start(): Promise<void>;
  end(): Promise<void>;
}

/**
 * Voice session hook: wraps LiveKit's `useSession` with a token source that calls our
 * `/voice/sessions` route (session-token auth, server-side tenant, policy and budget).
 */
export function useVoiceSession(options: UseVoiceSessionOptions = {}): UseVoiceSessionResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [details, setDetails] = useState<VoiceConnectionDetails | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [starting, setStarting] = useState(false);
  const tokens = useMemo(() => {
    const created = createVoiceTokenSource(
      () => requestVoiceSession(optionsRef.current),
      (next) => {
        setDetails(next);
        optionsRef.current.onDetails?.(next);
      },
    );
    // Armed once at creation: LiveKit's mount-time prepareConnection and our start share one request.
    if (optionsRef.current.autoStart) created.arm();
    return created;
  }, []);
  const session = useSession(tokens.source, options.agentConnectTimeoutMilliseconds ? { agentConnectTimeoutMilliseconds: options.agentConnectTimeoutMilliseconds } : {});

  const connect = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      await session.start();
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      setError(failure);
      optionsRef.current.onError?.(failure);
    } finally {
      setStarting(false);
    }
  }, [session]);

  /** A new call: a new voice session (room, dispatch, budget gate) on the Worker. */
  const start = useCallback(async () => {
    tokens.arm();
    await connect();
  }, [tokens, connect]);

  const end = useCallback(async () => {
    await session.end();
    const { token, notifyEnd, endpoint, fetch: customFetch } = optionsRef.current;
    if (details && token && notifyEnd !== false) {
      const doFetch = customFetch ?? globalThis.fetch.bind(globalThis);
      await doFetch(`${endpoint ?? "/voice/sessions"}/${details.voice_session_id}/end`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
  }, [session, details]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!options.autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void connect();
  }, [options.autoStart, connect]);

  return { session, details, voiceSessionId: details?.voice_session_id, conversationId: details?.conversation_id, error, starting, start, end };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeTelemetryMetrics, dedupeTelemetry, latestRunStatus, mergeTelemetry, parseTelemetryPayload } from "../internal/telemetry.ts";
import type { PusherLikeChannel, PusherLikeClient, RunStatus, TelemetryConnectionStatus, TelemetryEvent, TelemetryMetrics, TelemetrySource } from "../types.ts";

export interface ReconnectOptions {
  /** First retry delay. Default 500 ms. */
  initialDelayMs?: number;
  /** Delay cap. Default 30 s. */
  maxDelayMs?: number;
  /** Growth factor per failed attempt. Default 2. */
  factor?: number;
  /** Give up after this many consecutive failures. Default unlimited. */
  maxRetries?: number;
}

export interface UseAgentTelemetryOptions {
  /** Telemetry transport. `null`/`undefined` keeps the hook idle. */
  source: TelemetrySource | null | undefined;
  /** Events kept in memory (oldest dropped first). Default 1000. */
  maxEvents?: number;
  /** Events to start from (e.g. a history fetch); validated and deduped like live ones. */
  initialEvents?: readonly unknown[];
  /** Reconnect policy for websocket and sse sources. */
  reconnect?: ReconnectOptions;
  /** Called once per new, valid event. */
  onEvent?: (event: TelemetryEvent) => void;
  /** Called for every payload entry that fails validation (it is dropped). */
  onInvalid?: (value: unknown, error: Error) => void;
}

export interface UseAgentTelemetryResult {
  /** Valid, deduped events in timestamp order. */
  events: TelemetryEvent[];
  /** Turns, cost and runtime derived from the events. */
  metrics: TelemetryMetrics;
  /** Latest run status any event reported. */
  runStatus: RunStatus | undefined;
  /** Transport connection status. */
  status: TelemetryConnectionStatus;
  /** Latest transport error. */
  error: Error | undefined;
  /** Drops every event (and forgets seen ids). */
  clear(): void;
  /** Feeds payloads from another channel (e.g. `useAgentChat().telemetry`) through the same validation and dedupe. */
  ingest(payload: unknown): void;
}

/**
 * Default Pusher event name. Matches `PUSHER_TELEMETRY_EVENT` / `PusherPublisher` in `@agent-starter/integrations`,
 * so a publisher and this hook with no `eventName` always meet.
 */
export const PUSHER_TELEMETRY_EVENT = "agent-turn-executed";
/** Default named SSE event (unnamed `message` events are read too). */
const DEFAULT_SSE_EVENT = "telemetry";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Transport frames that are not plain events: the room Durable Object sends `{ type: "history", events: [...] }` on
 * connect (TelemetryEvents with stable ids, deduped against live ones). Older rooms sent one
 * `{ type: "history", message }` frame per transcript row, which carries no tenant/run fields: dropped quietly.
 */
export function unwrapTelemetryFrame(payload: unknown): unknown {
  let value = payload;
  if (typeof value === "string" && value.startsWith("{") && value.includes('"history"')) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return payload;
    }
  }
  if (isRecord(value) && value.type === "history") {
    if (Array.isArray(value.events)) return value.events;
    return [];
  }
  return payload;
}

/** Delay before reconnect attempt `attempt` (0-based), with ±20% jitter. */
export function backoffDelay(attempt: number, options: ReconnectOptions = {}): number {
  const { initialDelayMs = 500, maxDelayMs = 30_000, factor = 2 } = options;
  const base = Math.min(maxDelayMs, initialDelayMs * factor ** attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(Math.min(maxDelayMs, base + jitter)));
}

function sourceKey(source: TelemetrySource | null | undefined): string {
  if (!source) return "none";
  switch (source.type) {
    case "websocket":
      return `websocket:${source.url}:${JSON.stringify(source.protocols ?? null)}`;
    case "sse":
      return `sse:${source.url}:${source.withCredentials ? 1 : 0}:${source.eventName ?? DEFAULT_SSE_EVENT}`;
    case "pusher":
      return `pusher:${"channelName" in source ? source.channelName : ""}:${source.eventName ?? PUSHER_TELEMETRY_EVENT}`;
  }
}

/**
 * Subscribes to a live `TelemetryEvent` stream (agent WebSocket broadcasts,
 * an SSE relay, a Pusher channel the host already holds, or a private Pusher
 * channel the hook subscribes on the host's Pusher client). Incoming
 * payloads are zod-validated (invalid entries dropped), deduped by event id,
 * and kept in timestamp order; websocket and sse sources reconnect with
 * capped exponential backoff.
 */
export function useAgentTelemetry(options: UseAgentTelemetryOptions): UseAgentTelemetryResult {
  const { source, maxEvents = 1000 } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const seen = useRef(new Set<string>());
  const [events, setEvents] = useState<TelemetryEvent[]>(() => {
    // Idempotent (React may run initializers twice): derive, then record ids.
    const initial = dedupeTelemetry(parseTelemetryPayload(options.initialEvents ? [...options.initialEvents] : []).events).slice(-maxEvents);
    for (const event of initial) seen.current.add(event.id);
    return initial;
  });
  const [status, setStatus] = useState<TelemetryConnectionStatus>("idle");
  const [error, setError] = useState<Error | undefined>(undefined);

  const maxEventsRef = useRef(maxEvents);
  maxEventsRef.current = maxEvents;

  const ingest = useCallback((payload: unknown) => {
    const { events: valid, invalid } = parseTelemetryPayload(unwrapTelemetryFrame(payload));
    for (const entry of invalid) optionsRef.current.onInvalid?.(entry.value, entry.error);
    if (valid.length === 0) return;
    // Dedupe synchronously (not inside the state updater, which React may
    // replay) so each event is stored and reported exactly once.
    const fresh: TelemetryEvent[] = [];
    for (const event of valid) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      fresh.push(event);
    }
    if (fresh.length === 0) return;
    const seenLimit = Math.max(maxEventsRef.current * 4, 1000);
    if (seen.current.size > seenLimit) {
      let excess = seen.current.size - seenLimit;
      for (const id of seen.current) {
        if (excess-- <= 0) break;
        seen.current.delete(id);
      }
    }
    setEvents((previous) => mergeTelemetry(previous, fresh, new Set(), maxEventsRef.current));
    for (const event of fresh) optionsRef.current.onEvent?.(event);
  }, []);

  const clear = useCallback(() => {
    seen.current = new Set();
    setEvents([]);
  }, []);

  const key = sourceKey(source);
  const channel: PusherLikeChannel | undefined = source?.type === "pusher" && "channel" in source ? source.channel : undefined;
  const client: PusherLikeClient | undefined = source?.type === "pusher" && "client" in source ? source.client : undefined;

  useEffect(() => {
    const current = optionsRef.current.source;
    if (!current) {
      setStatus("idle");
      return;
    }
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let teardown: (() => void) | undefined;

    const scheduleReconnect = (connect: () => void, cause: Error) => {
      setError(cause);
      const policy = optionsRef.current.reconnect ?? {};
      if (policy.maxRetries !== undefined && attempt >= policy.maxRetries) {
        setStatus("error");
        return;
      }
      setStatus("reconnecting");
      const delay = backoffDelay(attempt, policy);
      attempt += 1;
      timer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };

    if (current.type === "websocket") {
      const connect = () => {
        setStatus(attempt === 0 ? "connecting" : "reconnecting");
        let socket: WebSocket;
        try {
          socket = new WebSocket(current.url, current.protocols);
        } catch (cause) {
          scheduleReconnect(connect, cause instanceof Error ? cause : new Error(String(cause)));
          return;
        }
        socket.onopen = () => {
          attempt = 0;
          setStatus("open");
          setError(undefined);
        };
        socket.onmessage = (message: MessageEvent) => ingest(message.data);
        socket.onerror = () => setError(new Error(`Telemetry WebSocket error (${current.url})`));
        socket.onclose = (event: CloseEvent) => {
          if (disposed) return;
          scheduleReconnect(connect, new Error(`Telemetry WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`));
        };
        teardown = () => {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000, "unsubscribed");
        };
      };
      connect();
    } else if (current.type === "sse") {
      const eventName = current.eventName ?? DEFAULT_SSE_EVENT;
      const connect = () => {
        setStatus(attempt === 0 ? "connecting" : "reconnecting");
        let stream: EventSource;
        try {
          stream = new EventSource(current.url, { withCredentials: current.withCredentials ?? false });
        } catch (cause) {
          scheduleReconnect(connect, cause instanceof Error ? cause : new Error(String(cause)));
          return;
        }
        const onMessage = (message: MessageEvent) => ingest(message.data);
        stream.onopen = () => {
          attempt = 0;
          setStatus("open");
          setError(undefined);
        };
        stream.onmessage = onMessage;
        if (eventName !== "message") stream.addEventListener(eventName, onMessage as EventListener);
        // Take over EventSource's fixed-interval retry so failures back off.
        stream.onerror = () => {
          stream.close();
          if (!disposed) scheduleReconnect(connect, new Error(`Telemetry SSE stream error (${current.url})`));
        };
        teardown = () => {
          stream.onopen = null;
          stream.onmessage = null;
          stream.onerror = null;
          if (eventName !== "message") stream.removeEventListener(eventName, onMessage as EventListener);
          stream.close();
        };
      };
      connect();
    } else {
      const eventName = current.eventName ?? PUSHER_TELEMETRY_EVENT;
      const handler = (data: unknown) => ingest(data);
      // A host-held channel, or one the hook subscribes (and unsubscribes) on the host's client.
      const owned = "client" in current ? current : undefined;
      let bound: PusherLikeChannel;
      try {
        bound = owned ? owned.client.subscribe(owned.channelName) : (current as { channel: PusherLikeChannel }).channel;
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setStatus("error");
        return;
      }
      bound.bind(eventName, handler);
      setStatus("open");
      setError(undefined);
      teardown = () => {
        bound.unbind(eventName, handler);
        if (owned) owned.client.unsubscribe(owned.channelName);
      };
    }

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      teardown?.();
      setStatus("closed");
    };
  }, [key, channel, client, ingest]);

  const metrics = useMemo(() => computeTelemetryMetrics(events), [events]);
  const runStatus = useMemo(() => latestRunStatus(events), [events]);

  return { events, metrics, runStatus, status, error, clear, ingest };
}

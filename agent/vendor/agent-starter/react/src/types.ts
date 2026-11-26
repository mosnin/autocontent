import type { ApprovalDecision, ApprovalStatus, RunStatus, TelemetryEvent } from "@agent-starter/core";

export type { ApprovalDecision, ApprovalStatus, RunStatus, TelemetryEvent };

/**
 * A human-in-the-loop approval request as agents stream it to the UI in a
 * Flue `data-approval` part (and optionally inside an `approval` telemetry
 * event's `data`).
 */
export interface ApprovalRequest {
  approvalId: string;
  /** Tool the agent wants to call. */
  tool: string;
  /** Free-form risk tier label (`low`, `medium`, `high`, `critical`, …). */
  riskTier: string;
  /** Why the call needs a human. */
  reason: string;
  /** Tool arguments the human is approving. */
  args: unknown;
  /** Signed single-use link that approves this request. */
  approveUrl?: string;
  /** Signed single-use link that rejects this request. */
  rejectUrl?: string;
  status: ApprovalStatus;
  /**
   * Chat only: id of the conversation message that first carried this
   * approval, so a transcript renders its card once, at the request's position.
   */
  messageId?: string;
}

/** Token and cost usage read from agent-authored message metadata. */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Model identity, when the agent reports one. */
  model?: string;
}

/** Aggregate run counters derived from a telemetry stream. */
export interface TelemetryMetrics {
  /** Model turns, summed across runs. */
  turns: number;
  /** Accumulated spend in USD, summed across runs. */
  costUsd: number;
  /** Longest run's wall-clock runtime (runs overlap, so this is a max). */
  runtimeSeconds: number;
  /**
   * Billed VM seconds from the run's ledger counters (`data.vmSeconds` on VM `sandbox` / `status` events),
   * summed across runs; 0 when no run used a VM.
   */
  vmSeconds: number;
}

/**
 * The minimal structural slice of a pusher-js `Channel` the telemetry hook
 * needs. Pass the host application's own channel; this package does not
 * depend on pusher-js.
 */
export interface PusherLikeChannel {
  bind(eventName: string, callback: (data: unknown) => void): unknown;
  unbind(eventName: string, callback?: (data: unknown) => void): unknown;
}

/**
 * The minimal structural slice of a pusher-js client (`new Pusher(key, { cluster, channelAuthorization })`) the
 * telemetry hook needs to subscribe to a private channel itself. The client's channel authorization endpoint is
 * the app's `POST /api/pusher/auth`.
 */
export interface PusherLikeClient {
  subscribe(channelName: string): PusherLikeChannel;
  unsubscribe(channelName: string): unknown;
}

/** Where `useAgentTelemetry` reads `TelemetryEvent`s from. */
export type TelemetrySource =
  | {
      type: "websocket";
      url: string;
      /** WebSocket subprotocols. */
      protocols?: string | string[];
    }
  | {
      type: "sse";
      url: string;
      /** Send cookies on cross-origin requests. */
      withCredentials?: boolean;
      /** Named SSE event carrying telemetry, in addition to unnamed `message` events. Default `telemetry`. */
      eventName?: string;
    }
  | {
      type: "pusher";
      channel: PusherLikeChannel;
      /** Pusher event name. Default `agent-turn-executed` (`PUSHER_TELEMETRY_EVENT`, same as the server publisher). */
      eventName?: string;
    }
  | {
      /** The hook subscribes `channelName` on `client` and unsubscribes on cleanup (see `pusherTelemetryChannel`). */
      type: "pusher";
      client: PusherLikeClient;
      channelName: string;
      /** Pusher event name. Default `agent-turn-executed`. */
      eventName?: string;
    };

/** Connection lifecycle of a telemetry source. */
export type TelemetryConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

/** Generative UI payload agents write as a Flue `data-openui` part. */
export interface OpenUIPayload {
  response: string;
  isStreaming?: boolean;
}

/** A structured signal delivered to the agent (`{ kind: 'signal' }` message). */
export interface AgentSignal {
  type: string;
  body: string;
  attributes?: Record<string, string>;
  tagName?: string;
}

/** A suggested prompt shown in an empty conversation. */
export type SuggestedPrompt = string | { label: string; prompt: string; description?: string };

/** Light, dark, or follow the operating system. */
export type ThemeMode = "light" | "dark" | "auto";

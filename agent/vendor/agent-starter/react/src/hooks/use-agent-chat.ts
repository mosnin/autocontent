import { useFlueAgent } from "@flue/react";
import type { FailedSend, FlueClient, FlueConversationMessage, SendMessageOptions, UseFlueAgentResult } from "@flue/react";
import { createFlueClient } from "@flue/sdk";
import type { AgentPromptOptions, AgentSendResult, ConversationLiveMode, DeliveredDocumentAttachment, DeliveredImageAttachment } from "@flue/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveApprovals, deriveTelemetry, deriveUsage } from "../internal/parts.ts";
import type { AgentSignal, AgentUsage, ApprovalRequest, TelemetryEvent } from "../types.ts";

export interface UseAgentChatOptions {
  /**
   * Conversation URL: the agent's mount plus a conversation id
   * (`/api/agents/support/${conversationId}`). Ignored when `client` is set.
   * Omit both to keep the hook dormant.
   */
  url?: string;
  /** Pre-configured Flue client (custom headers/fetch). Memoize it: a new instance starts a new session. */
  client?: FlueClient;
  /** Bearer token for the client built from `url`. */
  token?: string;
  /** Live transport. Default `sse`. */
  live?: ConversationLiveMode;
}

export interface UseAgentChatResult extends UseFlueAgentResult {
  /** The conversation client in use (`undefined` while dormant). */
  client: FlueClient | undefined;
  /** Latest state of every approval requested in the conversation (`data-approval` parts). */
  approvals: ApprovalRequest[];
  /** Approvals still awaiting a decision. */
  pendingApprovals: ApprovalRequest[];
  /** `TelemetryEvent`s streamed as `data-telemetry` parts, deduped and time-ordered. */
  telemetry: TelemetryEvent[];
  /** Token/cost usage summed from message metadata, when the agent reports it. */
  usage: AgentUsage | undefined;
  /** A prompt is being admitted or a response is streaming. */
  isBusy: boolean;
  /** An abort request is in flight. */
  isStopping: boolean;
  /** Aborts the running (and queued) work via `client.abort()`. Resolves `true` when something was aborted. */
  stop(): Promise<boolean>;
  /** Delivers a structured `{ kind: 'signal' }` message (escalations, UI events). */
  sendSignal(signal: AgentSignal, options?: Omit<AgentPromptOptions, "message">): Promise<AgentSendResult>;
  /** Re-sends a failed message, including the attachments of its optimistic echo. */
  retry(failed: FailedSend): Promise<AgentSendResult>;
}

function isAbsoluteUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/** Rebuilds the attachments of an optimistic user message from its `data:` URL previews. */
export function attachmentsFromMessage(message: FlueConversationMessage | undefined): Pick<SendMessageOptions, "images" | "documents"> {
  const images: DeliveredImageAttachment[] = [];
  const documents: DeliveredDocumentAttachment[] = [];
  for (const part of message?.parts ?? []) {
    if (part.type !== "file" || !part.url) continue;
    const match = DATA_URL.exec(part.url);
    if (!match?.[1] || match[2] === undefined) continue;
    const filename = part.filename ? { filename: part.filename } : {};
    if (match[1] === "application/pdf") documents.push({ type: "document", data: match[2], mimeType: "application/pdf", ...filename });
    else images.push({ type: "image", data: match[2], mimeType: match[1], ...filename });
  }
  return { ...(images.length ? { images } : {}), ...(documents.length ? { documents } : {}) };
}

/**
 * `useFlueAgent` plus the views agent UIs need: approvals, telemetry and
 * usage derived from the transcript, a busy flag, `stop()` (Flue's
 * `client.abort()`), structured signals, and attachment-preserving retry.
 */
export function useAgentChat(options: UseAgentChatOptions = {}): UseAgentChatResult {
  const { url, token, live } = options;
  const providedClient = options.client;
  const client = useMemo(() => {
    if (providedClient) return providedClient;
    if (!url) return undefined;
    // Relative URLs cannot resolve during server rendering: stay dormant until hydration.
    if (typeof globalThis.location === "undefined" && !isAbsoluteUrl(url)) return undefined;
    return createFlueClient({ url, ...(token ? { token } : {}) });
  }, [providedClient, url, token]);

  const agent = useFlueAgent({ ...(client ? { client } : {}), ...(live ? { live } : {}) });
  const { messages, status, sendMessage } = agent;

  const approvals = useMemo(() => deriveApprovals(messages), [messages]);
  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === "PENDING_APPROVAL"), [approvals]);
  const telemetry = useMemo(() => deriveTelemetry(messages), [messages]);
  const usage = useMemo(() => deriveUsage(messages), [messages]);

  const [isStopping, setStopping] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stop = useCallback(async () => {
    if (!client) return false;
    setStopping(true);
    try {
      const result = await client.abort();
      return result.aborted;
    } finally {
      if (mounted.current) setStopping(false);
    }
  }, [client]);

  const sendSignal = useCallback(
    async (signal: AgentSignal, sendOptions: Omit<AgentPromptOptions, "message"> = {}) => {
      if (!client) throw new Error("useAgentChat() cannot send a signal without a conversation url or client");
      return client.send({ ...sendOptions, message: { kind: "signal", ...signal } });
    },
    [client],
  );

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const retry = useCallback(
    (failed: FailedSend) => {
      const echo = messagesRef.current.find((message) => message.id === failed.id);
      return sendMessage(failed.message, attachmentsFromMessage(echo));
    },
    [sendMessage],
  );

  return {
    ...agent,
    client,
    approvals,
    pendingApprovals,
    telemetry,
    usage,
    isBusy: status === "submitted" || status === "streaming",
    isStopping,
    stop,
    sendSignal,
    retry,
  };
}

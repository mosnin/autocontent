import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { UseAgentChatResult } from "../hooks/use-agent-chat.ts";
import { cx, readableTextColor } from "../internal/format.ts";
import { useFocusTrap } from "../internal/use-focus-trap.ts";
import type { AgentSignal, ThemeMode } from "../types.ts";
import { ChatSurface, useResolvedChat } from "./chat/ChatSurface.tsx";
import type { ChatConnectionProps, ChatPresentationProps } from "./chat/types.ts";

/** The `{ kind: 'signal' }` message a "talk to a human" click produces. */
export interface EscalationSignal extends AgentSignal {
  kind: "signal";
  type: "escalation";
}

export interface ChatWidgetProps extends ChatConnectionProps, ChatPresentationProps {
  /** Corner the launcher and panel dock to. Default `bottom-right`. */
  position?: "bottom-right" | "bottom-left";
  /** Brand color for the launcher, header and primary buttons (any CSS color). */
  brandColor?: string;
  /** Panel title. Default "Support". */
  title?: string;
  /** Line under the title. */
  subtitle?: string;
  /** Avatar image URL for the header and assistant messages. */
  avatarUrl?: string;
  /** First assistant bubble (local, not sent to the agent). */
  greeting?: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state when uncontrolled. Default `false`. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Launcher accessible label. Default "Open chat". */
  launcherLabel?: string;
  /** Offer the "talk to a human" escalation. Default `true`. */
  showEscalation?: boolean;
  /** Escalation button text. Default "Talk to a human". */
  escalationLabel?: string;
  /**
   * Handles escalation. Receives the signal and the chat; return a promise
   * to show progress. Default: delivers the signal to the agent conversation
   * (`chat.sendSignal`), so the agent can hand off via its own tools.
   */
  onEscalate?: (signal: EscalationSignal, chat: UseAgentChatResult) => unknown;
  /** Extra attributes merged into the escalation signal (ticket id, customer tier, …). */
  escalationAttributes?: Record<string, string>;
  /** Stacking order. Default 2147483000. */
  zIndex?: number;
  /** Color scheme. Default `auto`. */
  theme?: ThemeMode;
  className?: string;
}

/**
 * Customer-support chat: a floating launcher bubble with an unread badge and
 * a compact chat panel (Esc closes, focus is trapped while open and returns
 * to the launcher), plus a "talk to a human" escalation.
 */
export function ChatWidget(props: ChatWidgetProps) {
  const {
    position = "bottom-right",
    brandColor,
    title = "Support",
    subtitle,
    avatarUrl,
    greeting,
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange,
    launcherLabel = "Open chat",
    showEscalation = true,
    escalationLabel = "Talk to a human",
    onEscalate,
    escalationAttributes,
    zIndex,
    theme = "auto",
    className,
    url: _url,
    client: _client,
    token: _token,
    live: _live,
    chat: _chat,
    ...surfaceProps
  } = props;
  const chat = useResolvedChat(props);
  const panelId = useId();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, [setOpen]);

  useFocusTrap(panelRef, isOpen, { onEscape: close, initialFocus: textareaRef });

  // Unread: assistant messages that arrived while the panel was closed.
  const assistantCount = chat.messages.filter((message) => message.role === "assistant" && message.display === "visible").length;
  const [seenCount, setSeenCount] = useState<number | null>(null);
  useEffect(() => {
    if (seenCount === null) {
      // History that loaded before the visitor interacted counts as read.
      if (chat.historyReady || !chat.client) setSeenCount(assistantCount);
      return;
    }
    if (isOpen && seenCount !== assistantCount) setSeenCount(assistantCount);
  }, [isOpen, assistantCount, seenCount, chat.historyReady, chat.client]);
  const unread = isOpen || seenCount === null ? 0 : Math.max(0, assistantCount - seenCount);

  const [escalation, setEscalation] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const escalate = async () => {
    if (escalation === "sending" || escalation === "sent") return;
    const signal: EscalationSignal = {
      kind: "signal",
      type: "escalation",
      body: "The customer asked to talk to a human agent.",
      attributes: { reason: "customer_request", source: "chat-widget", ...escalationAttributes },
    };
    setEscalation("sending");
    try {
      if (onEscalate) await onEscalate(signal, chat);
      else {
        const { kind: _kind, ...message } = signal;
        await chat.sendSignal(message);
      }
      setEscalation("sent");
    } catch {
      setEscalation("error");
    }
  };

  const contrast = brandColor ? readableTextColor(brandColor) : undefined;
  const style = {
    ...(brandColor ? { "--as-color-accent": brandColor } : {}),
    ...(contrast ? { "--as-color-accent-contrast": contrast } : {}),
    ...(zIndex !== undefined ? { "--as-widget-z": String(zIndex) } : {}),
  } as CSSProperties;

  const escalationBar = showEscalation ? (
    <div className="as-widget__escalation">
      {escalation === "sent" ? (
        <p className="as-widget__escalation-status" role="status">
          A human teammate has been notified and will join this conversation.
        </p>
      ) : (
        <>
          <button type="button" className="as-btn as-btn--ghost as-btn--sm" disabled={!chat.client || escalation === "sending"} onClick={() => void escalate()}>
            {escalation === "sending" ? "Requesting a human…" : escalationLabel}
          </button>
          {escalation === "error" ? (
            <span className="as-error-text" role="alert">
              Could not reach a human. Please try again.
            </span>
          ) : null}
        </>
      )}
    </div>
  ) : null;

  return (
    <div className={cx("as-root", "as-widget", `as-widget--${position}`, className)} data-theme={theme === "auto" ? undefined : theme} style={style}>
      {isOpen ? (
        <div ref={panelRef} id={panelId} className="as-widget__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <header className="as-widget__header">
            {avatarUrl ? <img className="as-widget__avatar" src={avatarUrl} alt="" /> : null}
            <div className="as-widget__heading">
              <h2 className="as-widget__title" id={titleId}>
                {title}
              </h2>
              {subtitle ? <p className="as-widget__subtitle">{subtitle}</p> : null}
            </div>
            <button type="button" className="as-icon-btn as-widget__close" aria-label="Close chat" onClick={close}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <ChatSurface
            {...surfaceProps}
            chat={chat}
            variant="compact"
            greeting={greeting}
            textareaRef={textareaRef}
            beforeComposer={escalationBar}
            {...(avatarUrl && !surfaceProps.assistantAvatarUrl ? { assistantAvatarUrl: avatarUrl } : {})}
          />
        </div>
      ) : null}
      <button
        ref={launcherRef}
        type="button"
        className="as-widget__launcher"
        aria-label={isOpen ? "Close chat" : unread ? `${launcherLabel}, ${unread} unread ${unread === 1 ? "message" : "messages"}` : launcherLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => (isOpen ? close() : setOpen(true))}
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.6.5-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="currentColor" />
          </svg>
        )}
        {unread > 0 ? (
          <span className="as-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
    </div>
  );
}

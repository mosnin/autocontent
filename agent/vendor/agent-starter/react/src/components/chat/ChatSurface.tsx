import type { FailedSend, FlueConversationMessage } from "@flue/react";
import type { ActionEvent } from "@openuidev/react-lang";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useAgentChat } from "../../hooks/use-agent-chat.ts";
import type { UseAgentChatResult } from "../../hooks/use-agent-chat.ts";
import { useApprovals } from "../../hooks/use-approvals.ts";
import { withContext } from "../../internal/context.ts";
import { cx, isSafeUrl } from "../../internal/format.ts";
import { useAutoScroll } from "../../internal/use-auto-scroll.ts";
import type { ApprovalRequest, SuggestedPrompt } from "../../types.ts";
import { Composer } from "./Composer.tsx";
import type { ComposerSubmission } from "./Composer.tsx";
import { MessageView } from "./MessageView.tsx";
import type { AttachmentOptions, ChatConnectionProps, ChatPresentationProps } from "./types.ts";

/** Uses `props.chat` when given; otherwise connects with the URL/client props. */
export function useResolvedChat(props: ChatConnectionProps): UseAgentChatResult {
  const own = useAgentChat(props.chat ? {} : { url: props.url, client: props.client, token: props.token, live: props.live });
  return props.chat ?? own;
}

export interface ChatSurfaceProps extends ChatPresentationProps {
  chat: UseAgentChatResult;
  variant: "page" | "compact";
  /** Static assistant greeting shown above the transcript (not sent to the agent). */
  greeting?: ReactNode;
  /** Final message text from the user's text plus optional action context (AgentSidebar injects page context here). */
  prepareMessage?: (text: string, actionContext: unknown) => string;
  /** Rendered between the transcript and the composer. */
  beforeComposer?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  emptyTitle?: string;
}

const DEFAULT_ATTACHMENTS: Required<AttachmentOptions> = { accept: "image/*,application/pdf", maxFiles: 4, maxFileBytes: 10 * 1024 * 1024 };

function promptOf(prompt: SuggestedPrompt): { label: string; prompt: string; description?: string } {
  return typeof prompt === "string" ? { label: prompt, prompt } : prompt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A cheap fingerprint that changes whenever the transcript grows. */
function contentKey(messages: readonly FlueConversationMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "0";
  let size = 0;
  for (const part of last.parts) {
    if (part.type === "text" || part.type === "reasoning") size += part.text.length;
    else if (part.type === "dynamic-tool") size += part.state.length + 1;
    else size += 1;
  }
  return `${messages.length}:${last.id}:${last.parts.length}:${size}`;
}

/** Transcript + composer shared by the full-page chat, the widget and the sidebar. */
export function ChatSurface(props: ChatSurfaceProps) {
  const { chat, variant } = props;
  const compact = variant === "compact";
  const assistantName = props.assistantName ?? "Assistant";
  const approvalsApi = useApprovals(props.approvals ?? {});
  const [localError, setLocalError] = useState<string | null>(null);

  const visible = useMemo(
    () => chat.messages.filter((message) => message.display === "visible" || (props.showDiagnostics === true && message.display === "diagnostic")),
    [chat.messages, props.showDiagnostics],
  );
  const failedById = useMemo(() => new Map(chat.failedSends.map((failed) => [failed.id, failed])), [chat.failedSends]);
  const { resolve } = approvalsApi;
  const approvalById = useMemo(() => new Map(chat.approvals.map((approval) => [approval.approvalId, resolve(approval)])), [chat.approvals, resolve]);
  // The response in progress: an assistant message after the latest user turn.
  const lastTurn = useMemo(() => [...visible].reverse().find((message) => message.role !== "system"), [visible]);
  const liveAssistantId = chat.isBusy && lastTurn?.role === "assistant" ? lastTurn.id : undefined;
  const scroll = useAutoScroll<HTMLDivElement>(contentKey(visible));

  const { prepareMessage, onSend } = props;
  const { sendMessage, client } = chat;
  const send = useCallback(
    async (text: string, options: { actionContext?: unknown; images?: ComposerSubmission["images"]; documents?: ComposerSubmission["documents"] } = {}) => {
      setLocalError(null);
      if (!client) {
        setLocalError("This chat is not connected to an agent.");
        return;
      }
      const body = prepareMessage ? prepareMessage(text, options.actionContext) : withContext(text, options.actionContext);
      onSend?.(text);
      try {
        await sendMessage(body, {
          ...(options.images?.length ? { images: options.images } : {}),
          ...(options.documents?.length ? { documents: options.documents } : {}),
        });
      } catch {
        // Admission failures are retained in `failedSends` and shown inline with a retry button.
      }
    },
    [client, prepareMessage, onSend, sendMessage],
  );

  const { onAction: userOnAction } = props;
  const onAction = useCallback(
    (event: ActionEvent) => {
      if (userOnAction) {
        userOnAction(event, chat);
        return;
      }
      if (event.type === "continue_conversation") {
        const formState = isRecord(event.formState) && Object.keys(event.formState).length ? event.formState : undefined;
        const actionContext = event.params.context ?? formState;
        if (event.humanFriendlyMessage.trim()) void send(event.humanFriendlyMessage, { actionContext });
      } else if (event.type === "open_url") {
        const url = event.params.url;
        if (typeof url === "string" && isSafeUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [userOnAction, chat, send],
  );

  const onRetry = useCallback(
    (failed: FailedSend) => {
      setLocalError(null);
      chat.retry(failed).catch(() => {
        // A repeated failure is retained in `failedSends` again.
      });
    },
    [chat],
  );

  const onRetrySubmission = useCallback(
    (submissionId: string) => {
      const original = chat.messages.find((message) => message.role === "user" && message.submissionId === submissionId);
      const text = original?.parts.find((part) => part.type === "text");
      if (text && text.type === "text") {
        sendMessage(text.text).catch(() => {
          // Retained in `failedSends`.
        });
      }
    },
    [chat.messages, sendMessage],
  );

  const decide = props.onApprovalDecision ?? approvalsApi.decide;
  const onDecide = useCallback((approval: ApprovalRequest, decision: "approve" | "reject", note?: string) => decide(approval, decision, note), [decide]);

  const stop = () => {
    chat.stop().catch((cause: unknown) => setLocalError(cause instanceof Error ? `Could not stop: ${cause.message}` : "Could not stop the agent."));
  };

  const attachments = props.attachments ? { ...DEFAULT_ATTACHMENTS, ...(props.attachments === true ? {} : props.attachments) } : null;
  const lastVisible = visible[visible.length - 1];
  const awaitingReply = chat.isBusy && (!lastTurn || lastTurn.role === "user");
  const loading = !chat.historyReady && chat.status === "connecting";
  const showEmpty = visible.length === 0 && !loading;
  const lastIsFailedNotice = lastVisible?.settlement?.outcome === "failed";
  const bannerError = localError ?? (chat.status === "error" && chat.error && chat.failedSends.length === 0 && !lastIsFailedNotice ? chat.error.message : null);
  const prompts = (props.suggestedPrompts ?? []).map(promptOf);

  return (
    <div className={cx("as-chat", compact && "as-chat--compact")}>
      <div className="as-chat__scroll" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="as-chat__transcript" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
          {props.greeting ? (
            <article className={cx("as-msg", "as-msg--assistant", compact && "as-msg--compact")} aria-label={assistantName}>
              {compact ? null : <span className="as-avatar" aria-hidden="true" />}
              <div className="as-msg__body">
                <div className="as-msg__content">{props.greeting}</div>
              </div>
            </article>
          ) : null}
          {loading ? (
            <div className="as-chat__loading" role="status">
              Loading conversation…
            </div>
          ) : null}
          {showEmpty && !props.greeting
            ? (props.emptyState ?? (
                <div className="as-empty">
                  <h2 className="as-empty__title">{props.emptyTitle ?? "How can I help?"}</h2>
                </div>
              ))
            : null}
          {visible.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              live={message.id === liveAssistantId}
              client={chat.client}
              failedSend={failedById.get(message.id)}
              onRetry={onRetry}
              onRetrySubmission={onRetrySubmission}
              approvalById={approvalById}
              pendingDecisions={approvalsApi.pending}
              onDecide={onDecide}
              library={props.library}
              onAction={onAction}
              showReasoning={props.showReasoning ?? true}
              showToolCalls={props.showToolCalls ?? true}
              renderDataPart={props.renderDataPart}
              assistantName={assistantName}
              assistantAvatarUrl={props.assistantAvatarUrl}
              compact={compact}
            />
          ))}
          {awaitingReply ? (
            <article className={cx("as-msg", "as-msg--assistant", compact && "as-msg--compact")} aria-label={assistantName} aria-busy="true">
              {compact ? null : <span className="as-avatar" aria-hidden="true" />}
              <div className="as-msg__body">
                <div className="as-typing" role="status">
                  <span className="as-sr-only">{assistantName} is thinking</span>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
              </div>
            </article>
          ) : null}
        </div>
        {showEmpty && prompts.length ? (
          <div className="as-suggestions" role="group" aria-label="Suggested prompts">
            {prompts.map((prompt) => (
              <button key={prompt.label} type="button" className="as-suggestion" disabled={!chat.client} onClick={() => void send(prompt.prompt)}>
                <span className="as-suggestion__label">{prompt.label}</span>
                {prompt.description ? <span className="as-suggestion__description">{prompt.description}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {scroll.hasNew && !scroll.atBottom ? (
        <button type="button" className="as-jump" onClick={() => scroll.scrollToBottom()}>
          Jump to latest <span aria-hidden="true">↓</span>
        </button>
      ) : null}
      {bannerError ? (
        <div className="as-banner as-banner--error" role="alert">
          <span>{bannerError}</span>
          {localError ? (
            <button type="button" className="as-btn as-btn--ghost as-btn--sm" onClick={() => setLocalError(null)}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      {props.beforeComposer}
      <Composer
        onSubmit={({ text, images, documents }) => void send(text, { images, documents })}
        onStop={stop}
        busy={chat.isBusy}
        stopping={chat.isStopping}
        disabled={!chat.client}
        placeholder={props.placeholder ?? `Message ${assistantName}…`}
        attachments={attachments}
        compact={compact}
        {...(props.textareaRef ? { textareaRef: props.textareaRef } : {})}
      />
    </div>
  );
}

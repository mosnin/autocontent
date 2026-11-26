import type { FailedSend, FlueClient, FlueConversationMessage, FlueConversationPart } from "@flue/react";
import type { ActionEvent, Library } from "@openuidev/react-lang";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { readMessageContext } from "../../internal/context.ts";
import { cx, formatDurationMs, formatNumber, formatUsd, initials, prettyValue } from "../../internal/format.ts";
import { Markdown } from "../../internal/markdown.tsx";
import { dataPartMatches, isDataPart, parseApprovals, parseOpenUIPayload, readMessageUsage, splitOpenUISegments } from "../../internal/parts.ts";
import type { DataPart, FilePart, ToolPart } from "../../internal/parts.ts";
import type { ApprovalDecision, ApprovalRequest } from "../../types.ts";
import { GenerativeUI } from "../GenerativeUI.tsx";
import { HumanOversightCard } from "../HumanOversightCard.tsx";

export interface MessageViewProps {
  message: FlueConversationMessage;
  /** The response is still being produced. */
  live: boolean;
  client: FlueClient | undefined;
  failedSend: FailedSend | undefined;
  onRetry: (failed: FailedSend) => void;
  /** Retry a settled-failed submission (re-sends its user message). */
  onRetrySubmission: (submissionId: string) => void;
  approvalById: ReadonlyMap<string, ApprovalRequest>;
  pendingDecisions: Readonly<Record<string, ApprovalDecision>>;
  onDecide: (approval: ApprovalRequest, decision: ApprovalDecision, note?: string) => unknown;
  library: Library | undefined;
  onAction: (event: ActionEvent) => void;
  showReasoning: boolean;
  showToolCalls: boolean;
  renderDataPart: ((part: DataPart, message: FlueConversationMessage) => ReactNode) | undefined;
  assistantName: string;
  assistantAvatarUrl: string | undefined;
  compact: boolean;
}

function ToolCallCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(part.state === "output-error");
  useEffect(() => {
    if (part.state === "output-error") setOpen(true);
  }, [part.state]);
  const statusLabel = part.state === "input-available" ? "Running" : part.state === "output-available" ? "Completed" : "Failed";
  const tone = part.state === "input-available" ? "running" : part.state === "output-available" ? "done" : "error";
  return (
    <details className={`as-tool as-tool--${tone}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="as-tool__summary">
        <span className={cx("as-tool__icon", tone === "running" && "as-spinner")} aria-hidden="true">
          {tone === "done" ? "✓" : tone === "error" ? "!" : ""}
        </span>
        <span className="as-tool__name">
          <span className="as-sr-only">Tool call </span>
          <code>{part.toolName}</code>
        </span>
        <span className="as-tool__status">{statusLabel}</span>
        {part.durationMs !== undefined ? <span className="as-tool__duration">{formatDurationMs(part.durationMs)}</span> : null}
      </summary>
      <div className="as-tool__body">
        <div className="as-tool__section">
          <div className="as-tool__label">Input</div>
          <pre tabIndex={0}>{prettyValue(part.input) || "(none)"}</pre>
        </div>
        {part.state === "output-available" ? (
          <div className="as-tool__section">
            <div className="as-tool__label">Output</div>
            <pre tabIndex={0}>{prettyValue(part.output) || "(empty)"}</pre>
          </div>
        ) : null}
        {part.state === "output-error" ? (
          <div className="as-tool__section as-tool__section--error">
            <div className="as-tool__label">Error</div>
            <pre tabIndex={0}>{part.errorText}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <details className={cx("as-reasoning", streaming && "as-reasoning--streaming")}>
      <summary>{streaming ? "Thinking…" : "Reasoning"}</summary>
      <div className="as-reasoning__text">{text}</div>
    </details>
  );
}

function FileView({ part, client }: { part: FilePart; client: FlueClient | undefined }) {
  const url = part.url ?? (part.id && client ? client.attachmentUrl(part.id) : undefined);
  const name = part.filename ?? (part.mediaType.startsWith("image/") ? "Image" : "Attachment");
  if (part.mediaType.startsWith("image/") && url) {
    return (
      <a className="as-file as-file--image" href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={part.filename ?? "Attached image"} loading="lazy" />
      </a>
    );
  }
  return url ? (
    <a className="as-file" href={url} target="_blank" rel="noopener noreferrer" download={part.filename}>
      <span aria-hidden="true">📎</span> {name}
    </a>
  ) : (
    <span className="as-file">
      <span aria-hidden="true">📎</span> {name}
    </span>
  );
}

function AssistantText({ text, live, library, onAction }: { text: string; live: boolean; library: Library | undefined; onAction: (event: ActionEvent) => void }) {
  const segments = splitOpenUISegments(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          <div className="as-md" key={index}>
            <Markdown text={segment.text} />
          </div>
        ) : (
          <GenerativeUI key={index} response={segment.source} isStreaming={live && !segment.complete} onAction={onAction} {...(library ? { library } : {})} />
        ),
      )}
    </>
  );
}

function Avatar({ name, url }: { name: string; url: string | undefined }) {
  return url ? <img className="as-avatar" src={url} alt="" /> : <span className="as-avatar" aria-hidden="true">{initials(name)}</span>;
}

/** One transcript message: user bubble, assistant response (text, reasoning, tools, UI, approvals) or system notice. */
export function MessageView(props: MessageViewProps) {
  const { message, live, client } = props;

  if (message.role === "system") {
    if (message.settlement?.outcome === "failed") {
      const submissionId = message.submissionId;
      return (
        <div className="as-notice as-notice--error" role="alert">
          <span>This response failed.</span>
          {submissionId ? (
            <button type="button" className="as-btn as-btn--ghost as-btn--sm" onClick={() => props.onRetrySubmission(submissionId)}>
              Retry
            </button>
          ) : null}
        </div>
      );
    }
    if (message.settlement?.outcome === "aborted") {
      return <div className="as-notice">Response stopped.</div>;
    }
    const text = message.parts
      .filter((part): part is Extract<FlueConversationPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text ? <div className="as-notice">{text}</div> : null;
  }

  if (message.role === "user") {
    const failed = props.failedSend;
    return (
      <article className={cx("as-msg", "as-msg--user", failed && "as-msg--failed")} aria-label="You">
        <div className="as-msg__bubble">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              const { text, context } = readMessageContext(part.text);
              return (
                <div key={index}>
                  <div className="as-msg__text">{text}</div>
                  {context !== null ? (
                    <span className="as-chip as-chip--context" title={prettyValue(context)}>
                      Context attached
                    </span>
                  ) : null}
                </div>
              );
            }
            if (part.type === "file") return <FileView key={index} part={part} client={client} />;
            return null;
          })}
        </div>
        {failed ? (
          <div className="as-msg__failed" role="alert">
            <span>Not sent: {failed.error.message}</span>
            <button type="button" className="as-btn as-btn--ghost as-btn--sm" onClick={() => props.onRetry(failed)}>
              Retry
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  const usage = live ? undefined : readMessageUsage(message);
  const hasVisibleContent = message.parts.some((part) => (part.type === "text" && part.text.trim()) || part.type === "dynamic-tool" || part.type === "file" || isDataPart(part));

  return (
    <article className={cx("as-msg", "as-msg--assistant", props.compact && "as-msg--compact")} aria-label={props.assistantName} aria-busy={live || undefined}>
      {props.compact ? null : <Avatar name={props.assistantName} url={props.assistantAvatarUrl} />}
      <div className="as-msg__body">
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text": {
              if (!part.text) return null;
              const streaming = part.state === "streaming";
              return (
                <div key={index} className={cx("as-msg__content", streaming && "as-streaming")}>
                  <AssistantText text={part.text} live={live} library={props.library} onAction={props.onAction} />
                </div>
              );
            }
            case "reasoning":
              return props.showReasoning && part.text ? <ReasoningBlock key={index} text={part.text} streaming={part.state === "streaming"} /> : null;
            case "dynamic-tool":
              return props.showToolCalls ? <ToolCallCard key={index} part={part} /> : null;
            case "file":
              return <FileView key={index} part={part} client={client} />;
            default: {
              if (!isDataPart(part)) return null;
              if (dataPartMatches(part, "approval")) {
                return parseApprovals(part.data).map((parsed) => {
                  const approval = props.approvalById.get(parsed.approvalId) ?? parsed;
                  // Render each approval once, where it was first requested, with its latest state.
                  if (approval.messageId && approval.messageId !== message.id) return null;
                  const pending = props.pendingDecisions[approval.approvalId];
                  return (
                    <HumanOversightCard
                      key={`${index}-${approval.approvalId}`}
                      approval={approval}
                      onDecide={props.onDecide}
                      compact={props.compact}
                      {...(pending ? { submitting: pending } : {})}
                    />
                  );
                });
              }
              if (dataPartMatches(part, "openui")) {
                const payload = parseOpenUIPayload(part.data);
                if (!payload) return null;
                return (
                  <GenerativeUI
                    key={index}
                    response={payload.response}
                    isStreaming={payload.isStreaming ?? false}
                    onAction={props.onAction}
                    {...(props.library ? { library: props.library } : {})}
                  />
                );
              }
              if (dataPartMatches(part, "telemetry")) return null;
              const custom = props.renderDataPart?.(part, message);
              return custom ? <div key={index}>{custom}</div> : null;
            }
          }
        })}
        {live && !hasVisibleContent ? (
          <div className="as-typing" role="status">
            <span className="as-sr-only">{props.assistantName} is thinking</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        ) : null}
        {usage && (usage.totalTokens > 0 || usage.costUsd > 0) ? (
          <div className="as-msg__meta">
            {usage.totalTokens > 0 ? `${formatNumber(usage.totalTokens)} tokens` : null}
            {usage.totalTokens > 0 && usage.costUsd > 0 ? " · " : null}
            {usage.costUsd > 0 ? formatUsd(usage.costUsd) : null}
            {usage.model ? ` · ${usage.model}` : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

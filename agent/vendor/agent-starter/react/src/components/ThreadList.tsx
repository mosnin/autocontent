import { useId } from "react";
import type { ThreadSummary } from "../hooks/use-threads.ts";
import { cx } from "../internal/format.ts";

export interface ThreadListProps {
  /** Newest first (e.g. `useThreads().threads`). */
  threads: readonly ThreadSummary[];
  /** The open conversation; rendered with `aria-current="page"`. */
  activeId?: string;
  onSelect: (conversationId: string) => void;
  /** Shows a "New chat" button when provided. */
  onNew?: () => void;
  /** Shows a per-thread delete button when provided. */
  onDelete?: (conversationId: string) => void;
  loading?: boolean;
  error?: Error | string | null;
  /** Heading and landmark label. Default "Conversations". */
  title?: string;
  /** Label for untitled threads. Default "New conversation". */
  untitledLabel?: string;
  /** Clock for relative times (tests). */
  now?: number;
  className?: string;
}

/** "just now", "5m", "3h", "2d", else a short date. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * ChatGPT-style thread switcher: a navigation landmark with a "New chat"
 * button and the user's past conversations (newest first). Pair it with
 * `useThreads()` and swap the `AgentChat` client when a thread is selected.
 */
export function ThreadList({ threads, activeId, onSelect, onNew, onDelete, loading = false, error, title = "Conversations", untitledLabel = "New conversation", now, className }: ThreadListProps) {
  const headingId = useId();
  const errorText = typeof error === "string" ? error : error?.message;
  return (
    <nav className={cx("as-threads", className)} aria-labelledby={headingId} aria-busy={loading || undefined}>
      <div className="as-threads__header">
        <h2 className="as-threads__title" id={headingId}>
          {title}
        </h2>
        {onNew ? (
          <button type="button" className="as-btn as-btn--primary as-btn--sm" onClick={onNew}>
            New chat
          </button>
        ) : null}
      </div>
      {errorText ? (
        <p className="as-error-text" role="alert">
          {errorText}
        </p>
      ) : null}
      {threads.length === 0 ? (
        <p className="as-threads__empty">{loading ? "Loading conversations…" : "No conversations yet."}</p>
      ) : (
        <ul className="as-threads__list">
          {threads.map((thread) => {
            const label = thread.title?.trim() || untitledLabel;
            const active = thread.conversationId === activeId;
            return (
              <li key={thread.conversationId} className={cx("as-threads__item", active && "as-threads__item--active")}>
                <button type="button" className="as-threads__select" aria-current={active ? "page" : undefined} onClick={() => onSelect(thread.conversationId)}>
                  <span className="as-threads__label">{label}</span>
                  <time className="as-threads__time" dateTime={new Date(thread.updatedAt).toISOString()}>
                    {relativeTime(thread.updatedAt, now)}
                  </time>
                </button>
                {onDelete ? (
                  <button type="button" className="as-icon-btn as-threads__delete" aria-label={`Delete ${label}`} onClick={() => onDelete(thread.conversationId)}>
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

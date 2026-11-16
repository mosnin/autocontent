import type { CSSProperties, ReactNode } from "react";
import { useId } from "react";
import { cx, formatNumber, formatUsd } from "../internal/format.ts";
import type { ThemeMode } from "../types.ts";
import { ChatSurface, useResolvedChat } from "./chat/ChatSurface.tsx";
import type { ChatConnectionProps, ChatPresentationProps } from "./chat/types.ts";

export interface AgentChatProps extends ChatConnectionProps, ChatPresentationProps {
  /** Header title. Omit (with `headerActions`) for a headerless chat. */
  title?: ReactNode;
  /** Controls rendered at the right of the header (new chat, settings, …). */
  headerActions?: ReactNode;
  /** Show summed token/cost usage in the header when the agent reports it. Default `true`. */
  showUsage?: boolean;
  /** Empty-state heading. Default "How can I help?". */
  emptyTitle?: string;
  /** Color scheme. Default `auto` (follows `prefers-color-scheme`). */
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Full-page, ChatGPT-style agent chat: streaming markdown, collapsible
 * reasoning, tool-call cards, OpenUI generative UI, inline human-oversight
 * cards, attachments, stop, retry and suggested prompts. Give it a container
 * with a height (it fills it).
 */
export function AgentChat(props: AgentChatProps) {
  const chat = useResolvedChat(props);
  const titleId = useId();
  const { title, headerActions, showUsage = true, theme = "auto", className, style, url: _url, client: _client, token: _token, live: _live, chat: _chat, ...rest } = props;
  const usage = showUsage ? chat.usage : undefined;
  const hasHeader = title !== undefined || headerActions !== undefined;
  return (
    <section
      className={cx("as-root", "as-agent-chat", className)}
      data-theme={theme === "auto" ? undefined : theme}
      style={style}
      {...(title !== undefined ? { "aria-labelledby": titleId } : { "aria-label": "Agent chat" })}
    >
      {hasHeader ? (
        <header className="as-agent-chat__header">
          {title !== undefined ? (
            <h1 className="as-agent-chat__title" id={titleId}>
              {title}
            </h1>
          ) : null}
          {usage ? (
            <span className="as-agent-chat__usage" title="Usage reported by the agent">
              {formatNumber(usage.totalTokens)} tokens · {formatUsd(usage.costUsd)}
            </span>
          ) : null}
          {headerActions ? <div className="as-agent-chat__actions">{headerActions}</div> : null}
        </header>
      ) : null}
      <ChatSurface {...rest} chat={chat} variant="page" />
    </section>
  );
}

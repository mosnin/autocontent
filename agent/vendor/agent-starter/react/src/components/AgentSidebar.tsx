import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { withContext } from "../internal/context.ts";
import { cx, prettyValue } from "../internal/format.ts";
import type { ThemeMode } from "../types.ts";
import { ChatSurface, useResolvedChat } from "./chat/ChatSurface.tsx";
import type { ChatConnectionProps, ChatPresentationProps } from "./chat/types.ts";

/** Structured page/entity context sent with every copilot message. */
export type SidebarContext = Record<string, unknown>;

export interface QuickAction {
  /** Stable key. Defaults to the label. */
  id?: string;
  label: string;
  /** Message sent when clicked (page context is attached). */
  prompt: string;
  /** Tooltip / accessible description. */
  description?: string;
}

export interface AgentSidebarProps extends ChatConnectionProps, ChatPresentationProps {
  /** Dock side. Default `right`. */
  side?: "right" | "left";
  /** Panel heading. Default "Copilot". */
  title?: ReactNode;
  /**
   * Current page/entity context, serialized into each message (OpenUI
   * message protocol, see `withContext`). A function is read at send time.
   */
  context?: SidebarContext | (() => SidebarContext | undefined);
  /** Label for the context chip. Default: `context.title`/`name`/`page`, else "Current page". */
  contextLabel?: string;
  /** One-click prompts shown above the composer. */
  quickActions?: QuickAction[];
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state when uncontrolled. Default `true`. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Allow drag/keyboard resizing. Default `true`. */
  resizable?: boolean;
  /** Controlled width in px. */
  width?: number;
  /** Initial width when uncontrolled. Default 380. */
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
  /**
   * `overlay` (default) docks the panel to the viewport edge; `inline`
   * renders it in normal flow so the host layout places it (e.g. a flex row).
   */
  mode?: "overlay" | "inline";
  /** Color scheme. Default `auto`. */
  theme?: ThemeMode;
  className?: string;
}

function resolveContext(context: AgentSidebarProps["context"]): SidebarContext | undefined {
  const value = typeof context === "function" ? context() : context;
  return value && Object.keys(value).length ? value : undefined;
}

function contextName(context: SidebarContext | undefined, label: string | undefined): string {
  if (label) return label;
  for (const key of ["title", "name", "page", "route", "path"]) {
    const value = context?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "Current page";
}

/**
 * In-app copilot panel docked to the right or left edge: resizable (pointer
 * or arrow keys on the separator), sends the host's page/entity `context`
 * with every message, and offers `quickActions`.
 */
export function AgentSidebar(props: AgentSidebarProps) {
  const {
    side = "right",
    title = "Copilot",
    context,
    contextLabel,
    quickActions,
    open: controlledOpen,
    defaultOpen = true,
    onOpenChange,
    resizable = true,
    width: controlledWidth,
    defaultWidth = 380,
    minWidth = 280,
    maxWidth = 720,
    onWidthChange,
    mode = "overlay",
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
  const titleId = useId();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Set when the user opens/closes the panel, so focus follows their action.
  const moveFocus = useRef(false);

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    moveFocus.current = true;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (isOpen) textareaRef.current?.focus();
    else toggleRef.current?.focus();
  }, [isOpen]);

  const clamp = useCallback((value: number) => Math.round(Math.min(maxWidth, Math.max(minWidth, value))), [minWidth, maxWidth]);
  const [uncontrolledWidth, setUncontrolledWidth] = useState(() => clamp(defaultWidth));
  const width = clamp(controlledWidth ?? uncontrolledWidth);
  const setWidth = (next: number) => {
    const value = clamp(next);
    if (controlledWidth === undefined) setUncontrolledWidth(value);
    onWidthChange?.(value);
  };

  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const delta = event.clientX - start.startX;
    setWidth(side === "right" ? start.startWidth - delta : start.startWidth + delta);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    // Arrow toward the page grows the panel.
    const grow = side === "right" ? "ArrowLeft" : "ArrowRight";
    const shrink = side === "right" ? "ArrowRight" : "ArrowLeft";
    if (event.key === grow) setWidth(width + step);
    else if (event.key === shrink) setWidth(width - step);
    else if (event.key === "Home") setWidth(minWidth);
    else if (event.key === "End") setWidth(maxWidth);
    else return;
    event.preventDefault();
  };

  const contextRef = useRef(context);
  contextRef.current = context;
  const prepareMessage = useCallback((text: string, actionContext: unknown) => {
    const pageContext = resolveContext(contextRef.current);
    if (!pageContext) return withContext(text, actionContext);
    return withContext(text, actionContext === undefined ? pageContext : { ...pageContext, action: actionContext });
  }, []);

  const currentContext = resolveContext(context);

  const sendQuickAction = (action: QuickAction) => {
    chat.sendMessage(prepareMessage(action.prompt, undefined)).catch(() => {
      // Retained in `failedSends` and shown with a retry button.
    });
    surfaceProps.onSend?.(action.prompt);
  };

  const themeAttr = theme === "auto" ? undefined : theme;

  if (!isOpen) {
    return (
      <div className={cx("as-root", "as-sidebar-toggle", `as-sidebar-toggle--${side}`, mode === "inline" && "as-sidebar-toggle--inline", className)} data-theme={themeAttr}>
        <button ref={toggleRef} type="button" className="as-btn as-btn--primary" aria-expanded={false} onClick={() => setOpen(true)}>
          {typeof title === "string" ? `Open ${title}` : "Open copilot"}
        </button>
      </div>
    );
  }

  const beforeComposer = (
    <>
      {currentContext ? (
        <details className="as-context">
          <summary>
            <span className="as-context__dot" aria-hidden="true" />
            Using context: <strong>{contextName(currentContext, contextLabel)}</strong>
          </summary>
          <pre tabIndex={0} aria-label="Context sent with each message">
            {prettyValue(currentContext)}
          </pre>
        </details>
      ) : null}
      {quickActions?.length ? (
        <div className="as-quick-actions" role="group" aria-label="Quick actions">
          {quickActions.map((action) => (
            <button
              key={action.id ?? action.label}
              type="button"
              className="as-chip as-chip--action"
              title={action.description}
              disabled={!chat.client}
              onClick={() => sendQuickAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );

  return (
    <aside
      id={panelId}
      className={cx("as-root", "as-sidebar", `as-sidebar--${side}`, mode === "inline" && "as-sidebar--inline", className)}
      data-theme={themeAttr}
      style={{ "--as-sidebar-width": `${width}px` } as CSSProperties}
      aria-labelledby={titleId}
    >
      {resizable ? (
        <div
          className="as-sidebar__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-controls={panelId}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onSeparatorKeyDown}
        />
      ) : null}
      <header className="as-sidebar__header">
        <h2 className="as-sidebar__title" id={titleId}>
          {title}
        </h2>
        <button
          type="button"
          className="as-icon-btn"
          aria-label="Close panel"
          onClick={() => {
            setOpen(false);
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <ChatSurface {...surfaceProps} chat={chat} variant="compact" prepareMessage={prepareMessage} beforeComposer={beforeComposer} textareaRef={textareaRef} />
    </aside>
  );
}

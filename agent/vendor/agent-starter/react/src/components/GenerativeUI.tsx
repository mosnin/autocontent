import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent, Library, OpenUIError, ParseResult, RendererProps } from "@openuidev/react-lang";
import { Component, useCallback, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { defaultLibrary } from "../generative/library.tsx";
import { cx } from "../internal/format.ts";

export interface GenerativeUIProps {
  /** OpenUI Lang program (bare, or inside ```openui-lang fences) as streamed so far. */
  response: string | null;
  /** The program is still streaming (interactions disabled, partial trees expected). */
  isStreaming?: boolean;
  /** Component library. Default `defaultLibrary`. */
  library?: Library;
  /** Button/action events (`continue_conversation`, `open_url`, custom actions). */
  onAction?: (event: ActionEvent) => void;
  /** Structured parser/runtime errors (`[]` when resolved). */
  onError?: (errors: OpenUIError[]) => void;
  /** Persist form state changes. */
  onStateUpdate?: (state: Record<string, unknown>) => void;
  /** Restore previously persisted form state. */
  initialState?: Record<string, unknown>;
  /** Runs `Query()`/`Mutation()` tools inside programs. */
  toolProvider?: RendererProps["toolProvider"];
  /** Shown instead of the UI when it cannot render. Default: the response as plain text. */
  fallback?: ReactNode | ((response: string, error: Error | undefined) => ReactNode);
  className?: string;
}

interface BoundaryProps {
  resetKey: string | null;
  fallback: (error: Error) => ReactNode;
  onRenderError?: (error: Error) => void;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/** Catches anything the OpenUI runtime throws and swaps in a text fallback until the response changes. */
class GenerativeUIErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onRenderError?.(error);
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

function PlainTextFallback({ text }: { text: string }) {
  return <pre className="as-genui__fallback">{text}</pre>;
}

/**
 * Renders OpenUI Lang with `@openuidev/react-lang`'s `Renderer` and the
 * package's default component library. Falls back to the raw text when the
 * program throws or (once streaming ends) yields nothing renderable.
 */
export function GenerativeUI({
  response,
  isStreaming = false,
  library = defaultLibrary,
  onAction,
  onError,
  onStateUpdate,
  initialState,
  toolProvider,
  fallback,
  className,
}: GenerativeUIProps) {
  const [renderable, setRenderable] = useState(true);
  const onParseResult = useCallback((result: ParseResult | null) => setRenderable(Boolean(result?.root)), []);

  const renderFallback = (error: Error | undefined): ReactNode => {
    const text = response ?? "";
    if (typeof fallback === "function") return fallback(text, error);
    if (fallback !== undefined) return fallback;
    return text.trim() ? <PlainTextFallback text={text} /> : null;
  };

  return (
    <div className={cx("as-genui", className)} aria-busy={isStreaming || undefined}>
      <GenerativeUIErrorBoundary resetKey={response} fallback={(error) => renderFallback(error)}>
        <Renderer
          response={response}
          library={library}
          isStreaming={isStreaming}
          onParseResult={onParseResult}
          {...(onAction ? { onAction } : {})}
          {...(onError ? { onError } : {})}
          {...(onStateUpdate ? { onStateUpdate } : {})}
          {...(initialState ? { initialState } : {})}
          {...(toolProvider !== undefined ? { toolProvider } : {})}
        />
        {!isStreaming && !renderable && response?.trim() ? renderFallback(undefined) : null}
      </GenerativeUIErrorBoundary>
    </div>
  );
}

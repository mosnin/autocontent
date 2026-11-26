import { useId, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cx, formatClock, formatNumber, formatTimeOfDay, formatUsd, initials, isoTime } from "../internal/format.ts";
import { senderColor } from "../internal/palette.ts";
import { computeTelemetryMetrics, dedupeTelemetry } from "../internal/telemetry.ts";
import { useAutoScroll } from "../internal/use-auto-scroll.ts";
import type { TelemetryEvent, ThemeMode } from "../types.ts";

export interface SwarmTimelineProps {
  /** Room telemetry (e.g. `useAgentTelemetry().events`); deduped and time-ordered here too. */
  events: readonly TelemetryEvent[];
  /** Heading. Default "Agent swarm". */
  title?: ReactNode;
  /** Only show these event types (counters still use every event). */
  types?: readonly TelemetryEvent["type"][];
  /** Override the deterministic per-sender color. */
  colorFor?: (senderId: string) => string;
  /** Show the turns/cost/runtime header. Default `true`. */
  showCounters?: boolean;
  /** Follow new events while the user is at the bottom. Default `true`. */
  autoScroll?: boolean;
  /** Shown before any event arrives. */
  emptyLabel?: ReactNode;
  /** Merge consecutive events from one sender within this window. Default 120 s. */
  groupWindowMs?: number;
  /** Color scheme. Default `auto`. */
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

interface Participant {
  senderId: string;
  senderRole: string;
  color: string;
  count: number;
}

/**
 * Multi-agent group-chat timeline: each sender gets a stable color, the
 * header tracks turns, spend and runtime, and the log follows new events
 * unless the user has scrolled up to read.
 */
export function SwarmTimeline({
  events,
  title = "Agent swarm",
  types,
  colorFor = senderColor,
  showCounters = true,
  autoScroll = true,
  emptyLabel = "Waiting for agents…",
  groupWindowMs = 120_000,
  theme = "auto",
  className,
  style,
}: SwarmTimelineProps) {
  const headingId = useId();
  const ordered = useMemo(() => dedupeTelemetry(events), [events]);
  const metrics = useMemo(() => computeTelemetryMetrics(ordered), [ordered]);
  const shown = useMemo(() => (types?.length ? ordered.filter((event) => types.includes(event.type)) : ordered), [ordered, types]);
  const participants = useMemo(() => {
    const byId = new Map<string, Participant>();
    for (const event of ordered) {
      const existing = byId.get(event.senderId);
      if (existing) existing.count += 1;
      else byId.set(event.senderId, { senderId: event.senderId, senderRole: event.senderRole, color: colorFor(event.senderId), count: 1 });
    }
    return [...byId.values()];
  }, [ordered, colorFor]);
  const last = shown[shown.length - 1];
  const scroll = useAutoScroll<HTMLDivElement>(`${shown.length}:${last?.id ?? ""}`, { enabled: autoScroll });

  return (
    <section className={cx("as-root", "as-swarm", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
      <header className="as-swarm__header">
        <h2 className="as-swarm__title" id={headingId}>
          {title}
        </h2>
        {showCounters ? (
          <dl className="as-counters" aria-label="Swarm counters">
            <div className="as-counter">
              <dt>Turns</dt>
              <dd>{formatNumber(metrics.turns)}</dd>
            </div>
            <div className="as-counter">
              <dt>Cost</dt>
              <dd>{formatUsd(metrics.costUsd)}</dd>
            </div>
            <div className="as-counter">
              <dt>Runtime</dt>
              <dd>{formatClock(metrics.runtimeSeconds)}</dd>
            </div>
            <div className="as-counter">
              <dt>Agents</dt>
              <dd>{participants.length}</dd>
            </div>
          </dl>
        ) : null}
      </header>
      {participants.length ? (
        <ul className="as-swarm__legend" aria-label="Participants">
          {participants.map((participant) => (
            <li key={participant.senderId} className="as-swarm__participant" style={{ "--as-sender-color": participant.color } as CSSProperties}>
              <span className="as-swarm__dot" aria-hidden="true" />
              <span>{participant.senderId}</span>
              {participant.senderRole && participant.senderRole !== participant.senderId ? <span className="as-swarm__role">{participant.senderRole}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="as-swarm__scroll" ref={scroll.ref} onScroll={scroll.onScroll} tabIndex={0} aria-label="Swarm messages">
        {shown.length === 0 ? (
          <p className="as-swarm__empty" role="status">
            {emptyLabel}
          </p>
        ) : (
          <ol className="as-swarm__list" role="log" aria-live="polite" aria-relevant="additions" aria-labelledby={headingId}>
            {shown.map((event, index) => {
              const previous = shown[index - 1];
              const grouped = previous !== undefined && previous.senderId === event.senderId && event.timestamp - previous.timestamp <= groupWindowMs;
              const color = colorFor(event.senderId);
              return (
                <li
                  key={event.id}
                  className={cx("as-swarm__item", grouped && "as-swarm__item--grouped", `as-log--${event.logType}`)}
                  style={{ "--as-sender-color": color } as CSSProperties}
                >
                  {grouped ? (
                    <span className="as-swarm__gutter" aria-hidden="true" />
                  ) : (
                    <span className="as-swarm__avatar" aria-hidden="true">
                      {initials(event.senderId)}
                    </span>
                  )}
                  <div className="as-swarm__body">
                    {grouped ? (
                      <span className="as-sr-only">{event.senderId}: </span>
                    ) : (
                      <div className="as-swarm__meta">
                        <span className="as-swarm__sender">{event.senderId}</span>
                        {event.senderRole ? <span className="as-swarm__role">{event.senderRole}</span> : null}
                        <time dateTime={isoTime(event.timestamp)}>{formatTimeOfDay(event.timestamp)}</time>
                      </div>
                    )}
                    <div className="as-swarm__content">
                      {event.logType !== "info" ? <span className={`as-tag as-tag--${event.logType}`}>{event.logType}</span> : null}
                      {event.type !== "message" && event.type !== "log" ? <span className="as-tag">{event.type}</span> : null}
                      <span>{event.content}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {scroll.hasNew && !scroll.atBottom ? (
        <button type="button" className="as-jump" onClick={() => scroll.scrollToBottom()}>
          New messages <span aria-hidden="true">↓</span>
        </button>
      ) : null}
    </section>
  );
}

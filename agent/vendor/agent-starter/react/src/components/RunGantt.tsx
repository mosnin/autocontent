/*
 * RunGantt: parallel agent runs over time with delegation edges.
 *
 * The layout (one row per actor ordered by first activity, greedy packing of overlapping runs into concurrency
 * sub-lanes, connectors from a source bar's trailing edge to a target bar's leading edge, dashed for retries, an
 * in-progress bar running to "now", tick-step choice) is adapted from paperclipai/paperclip
 * ui/src/lib/timeline/layout.ts and ui/src/components/timeline/WorkTimelineChart.tsx at commit
 * b2a7d322ed0bafda04a0b78ce14e4f25c8d5d170. MIT License, Copyright (c) 2025 Paperclip AI. The full permission notice is
 * in third_party/templates/paperclip/LICENSE and THIRD_PARTY_NOTICES.md.
 *
 * Modified for Agent Starter: rewritten over TelemetryEvent-derived spans with run/room/delegation edges, plain SVG
 * with the package's CSS tokens, keyboard-selectable bars, no mini-map, no avatars or issue hues.
 */
import { useId, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cx, formatTimeOfDay } from "../internal/format.ts";
import { senderColor } from "../internal/palette.ts";
import { dedupeTelemetry } from "../internal/telemetry.ts";
import type { TelemetryEvent, ThemeMode } from "../types.ts";

/** One agent run (or one agent's participation in a room) on the timeline. */
export interface GanttRun {
  runId: string;
  /** Row the run is drawn on (agent / participant id). */
  agent: string;
  label?: string;
  start: number;
  /** `null`/absent while running: the bar extends to `now`. */
  end?: number | null;
  status?: string;
  /** This run retries `retryOf`: incoming edges are dashed. */
  retryOf?: string;
}

/** Who handed work to whom. */
export interface GanttEdge {
  fromRunId: string;
  toRunId: string;
  kind?: "delegation" | "room" | "bus";
  dashed?: boolean;
}

export interface GanttLayoutBar {
  run: GanttRun;
  x1: number;
  x2: number;
  y: number;
  height: number;
  lane: number;
  running: boolean;
}

export interface GanttLayout {
  rows: Array<{ agent: string; y: number; height: number; bars: GanttLayoutBar[] }>;
  connectors: Array<{ x1: number; y1: number; x2: number; y2: number; dashed: boolean; kind: GanttEdge["kind"]; fromRunId: string; toRunId: string }>;
  width: number;
  height: number;
  from: number;
  to: number;
  ticks: number[];
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "HALTED", "TERMINATED", "IDLE", "completed", "failed", "cancelled"]);
const GUTTER = 140;
const AXIS = 24;

/**
 * Spans and edges from a telemetry stream. Each (runId, sender) pair is one bar, so a room (one runId, many
 * senders) shows every participant on its own row. Edges come from `data.edge = { from, to, kind }` on any event
 * (delegations, bus hops) and, inside a room, from each speaker to the next one.
 */
export function deriveGantt(events: readonly TelemetryEvent[], now = Date.now()): { runs: GanttRun[]; edges: GanttEdge[] } {
  const ordered = dedupeTelemetry(events);
  const runs = new Map<string, GanttRun>();
  const edges: GanttEdge[] = [];
  let previousRoomBar: { roomId: string; key: string; senderId: string } | null = null;
  for (const event of ordered) {
    const key = event.roomId ? `${event.runId}|${event.senderId}` : event.runId;
    const existing = runs.get(key);
    // Room participation is drawn as an activity span (first to last message); a run stays open until a terminal status.
    const done = event.roomId !== undefined || (event.status ? TERMINAL.has(event.status) : false);
    if (!existing) {
      runs.set(key, { runId: key, agent: event.senderId, label: event.senderRole || event.senderId, start: event.timestamp, end: done ? event.timestamp : null, ...(event.status ? { status: event.status } : {}) });
    } else {
      existing.end = done ? Math.max(existing.end ?? event.timestamp, event.timestamp) : null;
      if (event.status) existing.status = event.status;
    }
    const edge = event.data?.edge as { from?: unknown; to?: unknown; kind?: unknown } | undefined;
    if (edge && typeof edge.from === "string" && typeof edge.to === "string") {
      edges.push({ fromRunId: edge.from, toRunId: edge.to, ...(edge.kind === "delegation" || edge.kind === "room" || edge.kind === "bus" ? { kind: edge.kind } : {}) });
    }
    if (event.roomId && event.type === "message" && event.senderId !== "system") {
      if (previousRoomBar && previousRoomBar.roomId === event.roomId && previousRoomBar.senderId !== event.senderId) {
        edges.push({ fromRunId: previousRoomBar.key, toRunId: key, kind: "room" });
      }
      previousRoomBar = { roomId: event.roomId, key, senderId: event.senderId };
    }
  }
  for (const run of runs.values()) {
    if (run.end !== null && run.end !== undefined && run.end <= run.start) run.end = run.start + 1000;
    if (run.end === null && now < run.start) run.end = run.start + 1000;
  }
  const unique = new Map(edges.map((e) => [`${e.fromRunId}>${e.toRunId}`, e]));
  return { runs: [...runs.values()], edges: [...unique.values()] };
}

/** Pick a tick step (ms) that leaves roughly 120 px between labels. */
export function tickStepMs(pxPerMs: number): number {
  const steps = [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200, 21_600, 86_400].map((s) => s * 1000);
  for (const step of steps) if (step * pxPerMs >= 120) return step;
  return steps[steps.length - 1] as number;
}

/** Deterministic layout: rows per agent, greedy concurrency lanes, edge connectors. */
export function layoutGantt(runs: readonly GanttRun[], edges: readonly GanttEdge[], options: { width: number; now: number; barHeight?: number; laneGap?: number; rowPadding?: number }): GanttLayout {
  const barHeight = options.barHeight ?? 14;
  const laneGap = options.laneGap ?? 4;
  const pad = options.rowPadding ?? 8;
  const endOf = (r: GanttRun) => r.end ?? Math.max(options.now, r.start + 1000);
  const from = runs.length ? Math.min(...runs.map((r) => r.start)) : options.now - 60_000;
  const to = Math.max(from + 10_000, ...runs.map(endOf));
  const plot = Math.max(80, options.width - GUTTER - 16);
  const pxPerMs = plot / (to - from);
  const x = (t: number) => GUTTER + (t - from) * pxPerMs;
  const first = new Map<string, number>();
  for (const r of runs) first.set(r.agent, Math.min(first.get(r.agent) ?? Number.POSITIVE_INFINITY, r.start));
  const agents = [...first.keys()].sort((a, b) => (first.get(a) as number) - (first.get(b) as number) || a.localeCompare(b));
  const bars = new Map<string, GanttLayoutBar>();
  const rows: GanttLayout["rows"] = [];
  let y = AXIS;
  for (const agent of agents) {
    const own = runs.filter((r) => r.agent === agent).sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    const placed: GanttLayoutBar[] = [];
    for (const run of own) {
      let lane = laneEnds.findIndex((end) => end <= run.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endOf(run));
      } else laneEnds[lane] = endOf(run);
      const x1 = x(run.start);
      const bar: GanttLayoutBar = { run, x1, x2: Math.max(x1 + 4, x(endOf(run))), y: y + pad / 2 + lane * (barHeight + laneGap), height: barHeight, lane, running: run.end === null || run.end === undefined };
      placed.push(bar);
      bars.set(run.runId, bar);
    }
    const height = Math.max(1, laneEnds.length) * (barHeight + laneGap) + pad;
    rows.push({ agent, y, height, bars: placed });
    y += height;
  }
  const retries = new Set(runs.filter((r) => r.retryOf).map((r) => r.runId));
  const connectors: GanttLayout["connectors"] = [];
  for (const edge of edges) {
    const source = bars.get(edge.fromRunId);
    const target = bars.get(edge.toRunId);
    if (!source || !target || source === target) continue;
    connectors.push({ x1: Math.min(source.x2, target.x1), y1: source.y + source.height / 2, x2: target.x1, y2: target.y + target.height / 2, dashed: Boolean(edge.dashed || retries.has(edge.toRunId)), kind: edge.kind, fromRunId: edge.fromRunId, toRunId: edge.toRunId });
  }
  const step = tickStepMs(pxPerMs);
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return { rows, connectors, width: options.width, height: y + 4, from, to, ticks };
}

export interface RunGanttProps {
  /** Telemetry to derive runs and edges from (room WebSocket, run streams). */
  events?: readonly TelemetryEvent[];
  /** Explicit runs (e.g. from the run registry); merged with derived ones by runId. */
  runs?: readonly GanttRun[];
  /** Explicit edges (e.g. from the delegation ledger: requester run → worker run). */
  edges?: readonly GanttEdge[];
  title?: ReactNode;
  /** SVG width in px. Default 720. */
  width?: number;
  /** "Now" for in-progress bars (tests pass a fixed clock). Default Date.now(). */
  now?: number;
  selectedRunId?: string;
  onSelectRun?: (runId: string) => void;
  colorFor?: (agent: string) => string;
  emptyLabel?: ReactNode;
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

/** Gantt of parallel agent runs with delegation / room hand-off edges. */
export function RunGantt({ events = [], runs, edges, title = "Agent runs", width = 720, now, selectedRunId, onSelectRun, colorFor = senderColor, emptyLabel = "No runs yet.", theme = "auto", className, style }: RunGanttProps) {
  const headingId = useId();
  const clock = now ?? Date.now();
  const layout = useMemo(() => {
    const derived = deriveGantt(events, clock);
    const byId = new Map(derived.runs.map((r) => [r.runId, r]));
    for (const run of runs ?? []) byId.set(run.runId, run);
    return layoutGantt([...byId.values()], [...derived.edges, ...(edges ?? [])], { width, now: clock });
  }, [events, runs, edges, width, clock]);
  const markerId = `${headingId.replace(/[^A-Za-z0-9_-]/g, "")}-arrow`;
  const bars = layout.rows.flatMap((row) => row.bars);
  return (
    <section className={cx("as-root", "as-swarm", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
      <header className="as-swarm__header">
        <h2 className="as-swarm__title" id={headingId}>
          {title}
        </h2>
        <span style={{ color: "var(--as-color-text-muted)", fontSize: "0.82em" }}>
          {bars.length} run{bars.length === 1 ? "" : "s"} · {layout.connectors.length} hand-off{layout.connectors.length === 1 ? "" : "s"}
        </span>
      </header>
      {bars.length === 0 ? (
        <p className="as-swarm__empty" role="status">
          {emptyLabel}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <svg width={layout.width} height={layout.height} role="img" aria-label="Agent runs over time" style={{ display: "block", fontFamily: "var(--as-font)", fontSize: 11 }}>
            <defs>
              <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--as-color-text-muted)" />
              </marker>
            </defs>
            {layout.ticks.map((t) => {
              const tx = GUTTER + ((t - layout.from) / (layout.to - layout.from)) * (layout.width - GUTTER - 16);
              return (
                <g key={t}>
                  <line x1={tx} x2={tx} y1={AXIS - 4} y2={layout.height} stroke="var(--as-color-border)" />
                  <text x={tx + 2} y={12} fill="var(--as-color-text-muted)">
                    {formatTimeOfDay(t)}
                  </text>
                </g>
              );
            })}
            {layout.rows.map((row) => (
              <g key={row.agent} data-agent={row.agent}>
                <line x1={0} x2={layout.width} y1={row.y + row.height} y2={row.y + row.height} stroke="var(--as-color-border)" />
                <text x={8} y={row.y + row.height / 2 + 4} fill="var(--as-color-text)" style={{ fontWeight: 600 }}>
                  {row.agent.length > 20 ? `${row.agent.slice(0, 19)}…` : row.agent}
                </text>
              </g>
            ))}
            {layout.connectors.map((c) => (
              <path
                key={`${c.fromRunId}>${c.toRunId}`}
                data-edge={`${c.fromRunId}>${c.toRunId}`}
                d={`M${c.x1},${c.y1} C${c.x1 + 24},${c.y1} ${c.x2 - 24},${c.y2} ${c.x2},${c.y2}`}
                fill="none"
                stroke="var(--as-color-text-muted)"
                strokeWidth={1.25}
                strokeDasharray={c.dashed ? "4 3" : undefined}
                markerEnd={`url(#${markerId})`}
              />
            ))}
            {bars.map((bar) => {
              const color = colorFor(bar.run.agent);
              const selected = bar.run.runId === selectedRunId;
              const failed = bar.run.status === "FAILED" || bar.run.status === "HALTED";
              const label = `${bar.run.label ?? bar.run.agent}: ${formatTimeOfDay(bar.run.start)}–${bar.running ? "now" : formatTimeOfDay(bar.run.end ?? bar.run.start)}${bar.run.status ? ` (${bar.run.status})` : ""}`;
              return (
                <g
                  key={bar.run.runId}
                  data-run={bar.run.runId}
                  role={onSelectRun ? "button" : undefined}
                  tabIndex={onSelectRun ? 0 : undefined}
                  aria-label={label}
                  aria-pressed={onSelectRun ? selected : undefined}
                  onClick={onSelectRun ? () => onSelectRun(bar.run.runId) : undefined}
                  onKeyDown={onSelectRun ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelectRun(bar.run.runId)) : undefined}
                  style={{ cursor: onSelectRun ? "pointer" : undefined }}
                >
                  <title>{label}</title>
                  <rect x={bar.x1} y={bar.y} width={bar.x2 - bar.x1} height={bar.height} rx={4} fill={color} fillOpacity={bar.running ? 0.55 : 0.9} stroke={failed ? "var(--as-color-danger)" : selected ? "var(--as-color-text)" : "none"} strokeWidth={selected || failed ? 2 : 0} />
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

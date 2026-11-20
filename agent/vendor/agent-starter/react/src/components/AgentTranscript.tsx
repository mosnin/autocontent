/*
 * AgentTranscript: a per-agent drill-down of thought, plan, tool and approval rows.
 *
 * The render-class taxonomy (message / thought / plan / tool / permission / status / error), the read / write / admin
 * tool tone, and pairing a permission request with its outcome by id are adapted from block/buzz
 * desktop/src/features/agents/ui/agentSessionTypes.ts, agentSessionTranscript.ts (`processTranscriptEvent`) and
 * agentSessionToolClassifier.ts at commit 402bd1897f8b7a822819e13fe8afa20037dd1865. Copyright 2026 Block, Inc.
 * Licensed under the Apache License, Version 2.0 (see third_party/templates/buzz/LICENSE).
 *
 * MODIFIED for Agent Starter (Apache-2.0 section 4(b)): reimplemented as a pure reducer over Agent Starter
 * `TelemetryEvent`s (tool rows keyed by `data.toolCallId`, permission rows by `data.approvalId`), with a small
 * name-based tone classifier and a React list using the package's CSS tokens. No upstream code was copied verbatim.
 */
import { useId, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cx, formatTimeOfDay, isoTime } from "../internal/format.ts";
import { senderColor } from "../internal/palette.ts";
import { dedupeTelemetry } from "../internal/telemetry.ts";
import type { TelemetryEvent, ThemeMode } from "../types.ts";

export type TranscriptRenderClass = "message" | "thought" | "plan" | "tool" | "permission" | "status" | "error";
export type ToolTone = "read" | "write" | "admin";

export interface TranscriptRow {
  id: string;
  renderClass: TranscriptRenderClass;
  agent: string;
  text: string;
  timestamp: number;
  /** Tool rows. */
  tool?: string;
  tone?: ToolTone;
  toolStatus?: "running" | "completed" | "failed" | "pending";
  /** Permission rows: "pending" until a decision event with the same approval id arrives. */
  outcome?: "pending" | "approved" | "rejected" | "expired";
}

const READ = /^(get|list|read|search|fetch|find|lookup|look_up|check|recall|view|grep|browse|query|describe|status)/i;
const ADMIN = /(delete|drop|destroy|purge|admin|grant|revoke|deploy|approve|refund|transfer|terminate|shutdown)/i;

/** read / write / admin tone from the tool name (and side effect when the event carries it). */
export function toolTone(name: string, sideEffect?: unknown): ToolTone {
  if (sideEffect === "destructive" || ADMIN.test(name)) return "admin";
  if (sideEffect === "read" || sideEffect === "none" || READ.test(name)) return "read";
  return "write";
}

function toolStatus(status: unknown): TranscriptRow["toolStatus"] {
  if (status === "ok" || status === "simulated") return "completed";
  if (status === "approval_required") return "pending";
  if (status === "error" || status === "denied" || status === "invalid_arguments" || status === "budget_exceeded") return "failed";
  return "running";
}

function decision(event: TelemetryEvent): TranscriptRow["outcome"] {
  const raw = String(event.data?.status ?? event.data?.decision ?? event.status ?? "").toUpperCase();
  if (raw.includes("APPROV")) return "approved";
  if (raw.includes("REJECT") || raw.includes("DENIED")) return "rejected";
  if (raw.includes("EXPIRE")) return "expired";
  return "pending";
}

/**
 * Folds telemetry into transcript rows for one agent (or all when `agent` is omitted): tool events update one row per
 * `data.toolCallId`, approval events update one permission row per `data.approvalId` (request → outcome), cognitive /
 * memory events are thoughts, plan events plans, errors errors, everything else a status line.
 */
export function buildTranscript(events: readonly TelemetryEvent[], agent?: string): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const byKey = new Map<string, TranscriptRow>();
  for (const event of dedupeTelemetry(events)) {
    if (agent !== undefined && event.senderId !== agent) continue;
    const data = event.data ?? {};
    if (event.type === "approval" || (event.type === "tool" && data.status === "approval_required")) {
      const key = `permission:${String(data.approvalId ?? data.toolCallId ?? event.id)}`;
      const existing = byKey.get(key);
      const outcome = decision(event);
      if (existing) {
        if (outcome !== "pending") existing.outcome = outcome;
        continue;
      }
      const row: TranscriptRow = { id: key, renderClass: "permission", agent: event.senderId, text: event.content, timestamp: event.timestamp, ...(typeof data.tool === "string" ? { tool: data.tool } : {}), outcome };
      byKey.set(key, row);
      rows.push(row);
      continue;
    }
    if (event.type === "tool") {
      const name = String(data.tool ?? "tool");
      const key = `tool:${String(data.toolCallId ?? event.id)}`;
      const existing = byKey.get(key);
      const status = toolStatus(data.status);
      if (existing) {
        existing.toolStatus = status;
        existing.text = event.content;
        continue;
      }
      const row: TranscriptRow = { id: key, renderClass: "tool", agent: event.senderId, text: event.content, timestamp: event.timestamp, tool: name, tone: toolTone(name, data.sideEffect), toolStatus: status };
      byKey.set(key, row);
      rows.push(row);
      continue;
    }
    const renderClass: TranscriptRenderClass =
      event.type === "message"
        ? "message"
        : event.type === "plan"
          ? "plan"
          : event.type === "error" || event.logType === "error"
            ? "error"
            : event.logType === "cognitive" || event.type === "memory"
              ? "thought"
              : "status";
    rows.push({ id: event.id, renderClass, agent: event.senderId, text: event.content, timestamp: event.timestamp });
  }
  return rows;
}

export interface AgentTranscriptProps {
  events: readonly TelemetryEvent[];
  /** Agent (senderId) to drill into (controlled). Omit it to let the built-in picker choose (defaults to the first sender). */
  agent?: string;
  onAgentChange?: (agent: string) => void;
  /** Hide row classes (e.g. ["status"]). */
  hide?: readonly TranscriptRenderClass[];
  title?: ReactNode;
  emptyLabel?: ReactNode;
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

const LABEL: Record<TranscriptRenderClass, string> = { message: "message", thought: "thought", plan: "plan", tool: "tool", permission: "approval", status: "status", error: "error" };
const TONE_COLOR: Record<ToolTone, string> = { read: "var(--as-color-info)", write: "var(--as-color-warning)", admin: "var(--as-color-danger)" };

/** Per-agent transcript: what one agent thought, planned, ran and asked a human for, in order. */
export function AgentTranscript({ events, agent, onAgentChange, hide, title = "Agent transcript", emptyLabel = "Nothing from this agent yet.", theme = "auto", className, style }: AgentTranscriptProps) {
  const headingId = useId();
  const pickerId = useId();
  const agents = useMemo(() => [...new Set(dedupeTelemetry(events).map((e) => e.senderId))].filter((id) => id !== "system"), [events]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = agent ?? picked ?? agents[0];
  const rows = useMemo(() => (current === undefined ? [] : buildTranscript(events, current).filter((row) => !hide?.includes(row.renderClass))), [events, current, hide]);
  return (
    <section className={cx("as-root", "as-swarm", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
      <header className="as-swarm__header">
        <h2 className="as-swarm__title" id={headingId}>
          {title}
        </h2>
        {agents.length > 0 ? (
          <label htmlFor={pickerId} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.85em" }}>
            Agent
            <select
              id={pickerId}
              value={current}
              onChange={(e) => {
                setPicked(e.target.value);
                onAgentChange?.(e.target.value);
              }}
            >
              {agents.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <div className="as-swarm__scroll" tabIndex={0} aria-label="Transcript rows">
        {rows.length === 0 ? (
          <p className="as-swarm__empty" role="status">
            {emptyLabel}
          </p>
        ) : (
          <ol className="as-swarm__list" aria-labelledby={headingId} style={{ "--as-sender-color": senderColor(current ?? "") } as CSSProperties}>
            {rows.map((row) => (
              <li key={row.id} className={cx("as-swarm__item", `as-log--${row.renderClass === "error" ? "error" : row.renderClass === "thought" ? "cognitive" : "info"}`)} data-render-class={row.renderClass}>
                <div className="as-swarm__body">
                  <div className="as-swarm__meta">
                    <span className={`as-tag as-tag--${row.renderClass === "error" ? "error" : row.renderClass === "thought" ? "cognitive" : row.renderClass === "permission" ? "warning" : "info"}`}>{LABEL[row.renderClass]}</span>
                    {row.tool ? (
                      <span className="as-swarm__role" style={row.tone ? { color: TONE_COLOR[row.tone] } : undefined} title={row.tone ? `${row.tone} tool` : undefined}>
                        {row.tool}
                      </span>
                    ) : null}
                    {row.toolStatus ? <span data-tool-status={row.toolStatus}>{row.toolStatus}</span> : null}
                    {row.outcome ? <span data-outcome={row.outcome}>{row.outcome}</span> : null}
                    <time dateTime={isoTime(row.timestamp)}>{formatTimeOfDay(row.timestamp)}</time>
                  </div>
                  <div className="as-swarm__content">
                    <span>{row.text}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

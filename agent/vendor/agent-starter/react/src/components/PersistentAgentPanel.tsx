import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePersistentAgent } from "../hooks/use-persistent-agent.ts";
import type { PersistentProposal, PersistentTurnOutcome, PersistentTurnSummary, UsePersistentAgentOptions } from "../hooks/use-persistent-agent.ts";
import { cx, formatNumber, formatUsd, isoTime } from "../internal/format.ts";
import type { ThemeMode } from "../types.ts";

export interface PersistentAgentPanelProps extends Omit<UsePersistentAgentOptions, "audit"> {
  /**
   * Show the audit log. Pass true only for sessions with a security/admin role; the server enforces the role
   * either way (a 403 shows "restricted").
   */
  canReadAudit?: boolean;
  /** Heading. Default: the agent's name. */
  title?: ReactNode;
  /** Clock for "next tick in …" (tests). */
  now?: () => number;
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const OUTCOME_TONE: Record<PersistentTurnOutcome, Tone> = {
  ok: "success",
  heartbeat_ok: "neutral",
  skipped: "warning",
  error: "danger",
  killed: "danger",
  running: "info",
};

const OUTCOME_LABEL: Record<PersistentTurnOutcome, string> = {
  ok: "Acted",
  heartbeat_ok: "Nothing to do",
  skipped: "Skipped",
  error: "Error",
  killed: "Killed",
  running: "Running",
};

/** Tone of a turn's badge: a turn whose review blocked or escalated a call is at least a warning. */
export function turnTone(turn: Pick<PersistentTurnSummary, "outcome" | "reviews">): Tone {
  const base = OUTCOME_TONE[turn.outcome];
  if ((base === "success" || base === "neutral") && turn.reviews.some((r) => r.decision !== "approve")) return "warning";
  return base;
}

/** "in 12 min", "in 2 h 5 min", "due now", or "—" when nothing is scheduled. */
export function formatNextTick(nextTickAt: number | null, now: number): string {
  if (nextTickAt === null) return "—";
  const minutes = Math.round((nextTickAt - now) / 60_000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `in ${hours} h${rest ? ` ${rest} min` : ""}`;
}

/** A diff value on one line (long JSON is cut so a skill body does not flood the panel). */
export function showValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Owner console for one persistent (always-on) agent: status and next heartbeat, the kill switch (with
 * confirmation), the last turns with their auto-review decisions, pending config/skill proposals to approve or
 * reject, and the append-only audit log for security roles. Talks to the `persistent` module's control routes.
 */
export function PersistentAgentPanel({ canReadAudit = false, title, now = Date.now, theme = "auto", className, style, ...options }: PersistentAgentPanelProps) {
  const headingId = useId();
  const api = usePersistentAgent({ ...options, audit: canReadAudit });
  const { state } = api;
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const act = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        setBusy(null);
        setConfirming(false);
      }
    }
  };

  if (!state) {
    return (
      <section className={cx("as-root", "as-persistent", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
        <h2 className="as-control__title" id={headingId}>
          {title ?? "Persistent agent"}
        </h2>
        {api.error ? (
          <p className="as-error-text" role="alert">
            {api.error.message}
          </p>
        ) : (
          <p className="as-persistent__empty">Loading…</p>
        )}
      </section>
    );
  }

  const { config, status, turns } = state;
  const statusTone: Tone = status.killed ? "danger" : !status.enabled ? "neutral" : status.inFlight ? "info" : "success";
  const statusText = status.killed ? "Disabled (kill switch)" : !status.enabled ? "Paused" : status.inFlight ? "Working" : "Idle";
  const pending = api.proposals.filter((p) => p.status === "pending");

  return (
    <section className={cx("as-root", "as-persistent", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
      <header className="as-control__header">
        <div>
          <h2 className="as-control__title" id={headingId}>
            {title ?? config.name}
          </h2>
          <p className="as-control__run">
            agent:{config.agentId} · config v{config.version}
          </p>
        </div>
        <span className={`as-status as-status--${statusTone}`} role="status">
          <span className="as-sr-only">Agent status: </span>
          {statusText}
        </span>
      </header>

      <div className="as-persistent__grid">
        <section className="as-panel" aria-label="Schedule and limits">
          <h3 className="as-panel__title">Heartbeat</h3>
          <dl className="as-counters as-counters--grid">
            <div className="as-counter">
              <dt>Next tick</dt>
              <dd>{status.killed ? "stopped" : formatNextTick(status.nextTickAt, now())}</dd>
            </div>
            <div className="as-counter">
              <dt>Every</dt>
              <dd>{formatNumber(config.heartbeatMinutes)} min</dd>
            </div>
            <div className="as-counter">
              <dt>Tools / tick</dt>
              <dd>{formatNumber(config.maxToolCallsPerTick)}</dd>
            </div>
            <div className="as-counter">
              <dt>Daily budget</dt>
              <dd>
                {status.spentTodayUsd !== undefined ? `${formatUsd(status.spentTodayUsd)} / ` : ""}
                {formatUsd(config.dailyBudgetUsd)}
              </dd>
            </div>
          </dl>
          {config.schedules.length ? (
            <ul className="as-persistent__schedules" aria-label="Schedules">
              {config.schedules.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> <code>{s.cron}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="as-panel" aria-label="Kill switch">
          <h3 className="as-panel__title">Kill switch</h3>
          {status.killed ? (
            <button type="button" className="as-btn as-btn--secondary" disabled={busy !== null} onClick={() => void act("enable", () => api.setKilled(false))}>
              {busy === "enable" ? "Enabling…" : "Re-enable agent"}
            </button>
          ) : confirming ? (
            <div className="as-confirm" role="alertdialog" aria-labelledby={`${headingId}-kill`} onKeyDown={(event) => event.key === "Escape" && busy === null && setConfirming(false)}>
              <p className="as-confirm__title" id={`${headingId}-kill`}>
                Disable this agent?
              </p>
              <p className="as-confirm__body">Its heartbeat stops and every tool call is refused until someone re-enables it.</p>
              <div className="as-confirm__actions">
                <button ref={cancelRef} type="button" className="as-btn as-btn--secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="as-btn as-btn--danger" disabled={busy !== null} onClick={() => void act("disable", () => api.setKilled(true))}>
                  {busy === "disable" ? "Disabling…" : "Confirm disable"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="as-btn as-btn--danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
              Disable agent
            </button>
          )}
          {actionError ? (
            <p className="as-error-text" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      </div>

      <section className="as-panel" aria-label="Pending proposals">
        <h3 className="as-panel__title">Proposals {pending.length ? `(${pending.length})` : ""}</h3>
        {pending.length === 0 ? (
          <p className="as-persistent__empty">No pending proposals.</p>
        ) : (
          <ul className="as-persistent__list">
            {pending.map((p: PersistentProposal) => (
              <li key={p.id} className="as-persistent__proposal">
                <div>
                  <span className="as-status as-status--warning">{p.kind}</span> <strong>{p.summary || p.kind}</strong>
                  <p className="as-persistent__meta">
                    from {p.source} · {timeLabel(p.createdAt)}
                  </p>
                  {p.diff?.length ? (
                    <ul className="as-persistent__diff" aria-label="Changes">
                      {p.diff.map((d) => (
                        <li key={d.field}>
                          <code>{d.field}</code>: <del>{showValue(d.before)}</del> → <ins>{showValue(d.after)}</ins>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {p.reason ? <p className="as-persistent__meta">Reason: {p.reason}</p> : null}
                </div>
                <label className="as-sr-only" htmlFor={`${headingId}-note-${p.id}`}>
                  Note for {p.summary || p.kind}
                </label>
                <input
                  id={`${headingId}-note-${p.id}`}
                  className="as-input"
                  placeholder="Note (optional)"
                  value={notes[p.id] ?? ""}
                  onChange={(event) => setNotes((n) => ({ ...n, [p.id]: event.target.value }))}
                />
                <div className="as-confirm__actions">
                  <button type="button" className="as-btn as-btn--secondary as-btn--sm" disabled={busy !== null} onClick={() => void act(`reject:${p.id}`, () => api.decide(p.id, "reject", notes[p.id]?.trim() || undefined))}>
                    {busy === `reject:${p.id}` ? "Rejecting…" : "Reject"}
                  </button>
                  <button type="button" className="as-btn as-btn--primary as-btn--sm" disabled={busy !== null} onClick={() => void act(`approve:${p.id}`, () => api.decide(p.id, "approve", notes[p.id]?.trim() || undefined))}>
                    {busy === `approve:${p.id}` ? "Approving…" : "Approve"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="as-panel" aria-label="Recent turns">
        <h3 className="as-panel__title">Recent turns</h3>
        {turns.length === 0 ? (
          <p className="as-persistent__empty">No turns yet.</p>
        ) : (
          <ul className="as-persistent__list">
            {turns.map((turn) => (
              <li key={turn.turnId} className="as-persistent__turn">
                <span className={`as-status as-status--${turnTone(turn)}`}>{OUTCOME_LABEL[turn.outcome]}</span>
                <span className="as-persistent__trigger">{turn.trigger}</span>
                <time dateTime={isoTime(turn.startedAt)}>{timeLabel(turn.startedAt)}</time>
                <span className="as-num">{formatUsd(turn.costUsd)}</span>
                {turn.toolCalls.length ? <span className="as-persistent__meta">{turn.toolCalls.join(", ")}</span> : null}
                {turn.reviews
                  .filter((r) => r.decision !== "approve")
                  .map((r, index) => (
                    <span key={`${r.tool}-${index}`} className="as-persistent__review">
                      review {r.decision} <code>{r.tool}</code>: {r.reason}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canReadAudit ? (
        <section className="as-panel" aria-label="Audit log">
          <h3 className="as-panel__title">Audit log</h3>
          {api.auditForbidden ? (
            <p className="as-persistent__empty">Restricted to security and admin roles.</p>
          ) : api.audit.length === 0 ? (
            <p className="as-persistent__empty">No audit entries.</p>
          ) : (
            <table className="as-persistent__audit">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Actor</th>
                  <th scope="col">What</th>
                </tr>
              </thead>
              <tbody>
                {api.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={isoTime(entry.at)}>{timeLabel(entry.at)}</time>
                    </td>
                    <td>{entry.kind}</td>
                    <td>{entry.actor}</td>
                    <td>{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {api.auditHasMore ? (
            <button type="button" className="as-btn as-btn--ghost as-btn--sm" disabled={busy !== null} onClick={() => void act("audit", api.loadMoreAudit)}>
              Load older entries
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

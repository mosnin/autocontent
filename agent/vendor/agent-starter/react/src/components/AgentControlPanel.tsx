import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useApprovals } from "../hooks/use-approvals.ts";
import type { UseApprovalsOptions } from "../hooks/use-approvals.ts";
import { cx, formatClock, formatNumber, formatTimeOfDay, formatUsd } from "../internal/format.ts";
import { parseApprovals } from "../internal/parts.ts";
import { computeTelemetryMetrics, dedupeTelemetry, deriveRunStatus } from "../internal/telemetry.ts";
import { useAutoScroll } from "../internal/use-auto-scroll.ts";
import type { ApprovalDecision, ApprovalRequest, RunStatus, TelemetryConnectionStatus, TelemetryEvent, ThemeMode } from "../types.ts";
import { HumanOversightCard } from "./HumanOversightCard.tsx";

export interface AgentControlPanelProps {
  /** The run's telemetry (e.g. `useAgentTelemetry().events`). */
  events: readonly TelemetryEvent[];
  /**
   * Current run status. Default: the latest status any event reported. Combine the stream with the run
   * registry and the live submission with `deriveRunStatus(events, { registry, busy })`.
   */
  status?: RunStatus;
  /** Pause the agent's fiber (manual override). */
  onPause?: () => unknown;
  /** Resume a paused run (`HALTED`, `PAUSED_OVERSIGHT`) or a failed one; shown instead of Pause in those states. */
  onResume?: () => unknown;
  /** Emergency teardown (terminate the VM/sandbox and cancel the run). Requires confirmation. */
  onTeardown?: () => unknown;
  /** Budget circuit-breaker limit in USD. */
  budgetUsd?: number;
  /** Turn limit of the run, shown next to the turn count. */
  maxTurns?: number;
  /** Billed VM seconds (e.g. registry counters). Default: the `data.vmSeconds` counters VM telemetry carries. */
  vmSeconds?: number;
  /** Approval to show while the run awaits oversight. Default: the latest `approval` event whose `data` is an approval request. */
  approval?: ApprovalRequest | null;
  /** Decision handler for the oversight card. Default: POST via `approvals`. */
  onDecide?: (approval: ApprovalRequest, decision: ApprovalDecision, note?: string) => unknown;
  /** Where the built-in handler POSTs decisions. */
  approvals?: UseApprovalsOptions;
  /** Telemetry connection status, shown as a live indicator. */
  connectionStatus?: TelemetryConnectionStatus;
  /** Heading. Default "Agent run". */
  title?: ReactNode;
  /** Run id shown under the heading. Default: from the events. */
  runId?: string;
  /** Color scheme. Default `auto`. */
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
}

const STATUS_TONE: Record<RunStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  IDLE: "neutral",
  QUEUED: "neutral",
  RUNNING: "info",
  PROVISIONING: "info",
  PENDING_APPROVAL: "warning",
  PAUSED_OVERSIGHT: "warning",
  STOPPING: "neutral",
  HALTED: "danger",
  COMPLETED: "success",
  FAILED: "danger",
  TERMINATED: "danger",
};

/** Nothing left to tear down: the run finished or an operator already terminated it. */
const FINAL: ReadonlySet<RunStatus> = new Set(["COMPLETED", "TERMINATED"]);
const PAUSABLE: ReadonlySet<RunStatus> = new Set(["RUNNING", "PROVISIONING", "QUEUED"]);
const OVERSIGHT: ReadonlySet<RunStatus> = new Set(["PAUSED_OVERSIGHT", "PENDING_APPROVAL"]);
/** States the operator can wake (the background job routes resume HALTED and FAILED jobs). */
const RESUMABLE: ReadonlySet<RunStatus> = new Set(["PAUSED_OVERSIGHT", "HALTED", "FAILED"]);

function statusLabel(status: RunStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Budget use as a whole percentage (uncapped, so 120% shows an overrun). */
export function budgetPercent(costUsd: number, budgetUsd: number): number {
  if (!(budgetUsd > 0)) return 0;
  return Math.round((costUsd / budgetUsd) * 1000) / 10;
}

function approvalFromEvents(events: readonly TelemetryEvent[]): ApprovalRequest | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "approval" || !event.data) continue;
    const [approval] = parseApprovals(event.data);
    if (approval) return approval;
  }
  return undefined;
}

/**
 * Operator console for one autonomous run: a terminal-style trajectory log
 * (left two thirds) and, on the right, resource analytics (turns, spend, wall-clock
 * runtime, billed VM time, a budget circuit-breaker meter) with manual overrides
 * (pause, resume a halted or failed run, emergency teardown with confirmation).
 * Shows the human-oversight card while the run is `PAUSED_OVERSIGHT` or
 * `PENDING_APPROVAL`.
 */
export function AgentControlPanel({
  events,
  status: statusProp,
  onPause,
  onResume,
  onTeardown,
  budgetUsd,
  maxTurns,
  vmSeconds: vmSecondsProp,
  approval: approvalProp,
  onDecide,
  approvals: approvalOptions,
  connectionStatus,
  title = "Agent run",
  runId: runIdProp,
  theme = "auto",
  className,
  style,
}: AgentControlPanelProps) {
  const headingId = useId();
  const budgetLabelId = useId();
  const ordered = useMemo(() => dedupeTelemetry(events), [events]);
  const metrics = useMemo(() => computeTelemetryMetrics(ordered), [ordered]);
  const status: RunStatus = statusProp ?? deriveRunStatus(ordered);
  const vmSeconds = vmSecondsProp ?? metrics.vmSeconds;
  const runId = runIdProp ?? ordered[ordered.length - 1]?.runId;
  const last = ordered[ordered.length - 1];
  const scroll = useAutoScroll<HTMLDivElement>(`${ordered.length}:${last?.id ?? ""}`);

  const approvalsApi = useApprovals(approvalOptions ?? {});
  const derivedApproval = approvalProp === undefined ? approvalFromEvents(ordered) : (approvalProp ?? undefined);
  const approval = derivedApproval ? approvalsApi.resolve(derivedApproval) : undefined;
  const decide = onDecide ?? approvalsApi.decide;

  const [busy, setBusy] = useState<"pause" | "resume" | "teardown" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const teardownRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const restoreTeardownFocus = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (restoreTeardownFocus.current) {
      restoreTeardownFocus.current = false;
      teardownRef.current?.focus();
    }
  }, [confirming]);

  const run = async (kind: "pause" | "resume" | "teardown", action: (() => unknown) | undefined) => {
    if (!action || busy) return;
    setBusy(kind);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        setBusy(null);
        if (kind === "teardown") setConfirming(false);
      }
    }
  };

  const percent = budgetUsd !== undefined ? budgetPercent(metrics.costUsd, budgetUsd) : undefined;
  const budgetTone = percent === undefined ? "default" : percent >= 90 ? "error" : percent >= 70 ? "warning" : "success";
  const final = FINAL.has(status);
  const showResume = onResume !== undefined && RESUMABLE.has(status);

  return (
    <section className={cx("as-root", "as-control", className)} data-theme={theme === "auto" ? undefined : theme} style={style} aria-labelledby={headingId}>
      <header className="as-control__header">
        <div>
          <h2 className="as-control__title" id={headingId}>
            {title}
          </h2>
          {runId ? <p className="as-control__run">Run {runId}</p> : null}
        </div>
        <div className="as-control__badges">
          {connectionStatus ? (
            <span className={cx("as-live", `as-live--${connectionStatus}`)}>
              <span className="as-live__dot" aria-hidden="true" />
              {connectionStatus === "open" ? "Live" : connectionStatus === "reconnecting" ? "Reconnecting…" : connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </span>
          ) : null}
          <span className={`as-status as-status--${STATUS_TONE[status]}`} role="status">
            <span className="as-sr-only">Run status: </span>
            {statusLabel(status)}
          </span>
        </div>
      </header>

      <div className="as-control__grid">
        <div className="as-terminal">
          <div className="as-terminal__bar" aria-hidden="true">
            <span />
            <span />
            <span />
            <span className="as-terminal__label">
              trajectory · {formatNumber(ordered.length)} {ordered.length === 1 ? "event" : "events"}
            </span>
          </div>
          <div className="as-terminal__scroll" ref={scroll.ref} onScroll={scroll.onScroll} tabIndex={0} role="log" aria-live="polite" aria-relevant="additions" aria-label="Agent trajectory log">
            {ordered.length === 0 ? (
              <p className="as-terminal__empty">$ waiting for agent output…</p>
            ) : (
              ordered.map((event) => (
                <div key={event.id} className={`as-terminal__line as-log--${event.logType}`}>
                  <span className="as-terminal__time">{formatTimeOfDay(event.timestamp)}</span>
                  <span className="as-terminal__type">{event.type.padEnd(7, " ")}</span>
                  <span className="as-terminal__sender">{event.senderRole || event.senderId}</span>
                  <span className="as-terminal__content">{event.content}</span>
                </div>
              ))
            )}
          </div>
          {scroll.hasNew && !scroll.atBottom ? (
            <button type="button" className="as-jump as-jump--terminal" onClick={() => scroll.scrollToBottom()}>
              Follow output <span aria-hidden="true">↓</span>
            </button>
          ) : null}
        </div>

        <aside className="as-control__side" aria-label="Run analytics and overrides">
          <section className="as-panel" aria-label="Resource analytics">
            <h3 className="as-panel__title">Resources</h3>
            <dl className="as-counters as-counters--grid">
              <div className="as-counter">
                <dt>Turns</dt>
                <dd>
                  {formatNumber(metrics.turns)}
                  {maxTurns !== undefined ? <span className="as-counter__limit"> / {formatNumber(maxTurns)}</span> : null}
                </dd>
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
                <dt>VM time</dt>
                <dd>{vmSeconds > 0 ? formatClock(vmSeconds) : "—"}</dd>
              </div>
            </dl>
            {budgetUsd !== undefined && percent !== undefined ? (
              <div className="as-budget">
                <div className="as-budget__head">
                  <span id={budgetLabelId}>Budget</span>
                  <span className="as-num">
                    {formatUsd(metrics.costUsd)} / {formatUsd(budgetUsd)} · <strong>{percent}%</strong>
                  </span>
                </div>
                <div
                  className={cx("as-meter", budgetTone !== "default" && `as-meter--${budgetTone}`)}
                  role="progressbar"
                  aria-labelledby={budgetLabelId}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, percent)}
                  aria-valuetext={`${percent}% of budget used`}
                >
                  <div className="as-meter__fill" style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
                {percent >= 100 ? (
                  <p className="as-budget__note as-budget__note--tripped" role="alert">
                    Circuit breaker tripped: budget exhausted.
                  </p>
                ) : percent >= 90 ? (
                  <p className="as-budget__note">Approaching the budget limit.</p>
                ) : null}
              </div>
            ) : null}
          </section>

          {OVERSIGHT.has(status) ? (
            approval ? (
              <HumanOversightCard
                key={approval.approvalId}
                approval={approval}
                onDecide={decide}
                compact
                {...(approvalsApi.pending[approval.approvalId] ? { submitting: approvalsApi.pending[approval.approvalId] } : {})}
              />
            ) : (
              <div className="as-callout as-callout--warning" role="note">
                <span className="as-callout__icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <div className="as-callout__title">Awaiting human oversight</div>
                  <div className="as-callout__body">The run is paused until an operator reviews it.</div>
                </div>
              </div>
            )
          ) : null}

          <section className="as-panel" aria-label="Manual overrides">
            <h3 className="as-panel__title">Manual overrides</h3>
            <div className="as-control__overrides">
              {showResume ? (
                <button type="button" className="as-btn as-btn--secondary" disabled={busy !== null} onClick={() => void run("resume", onResume)}>
                  {busy === "resume" ? "Resuming…" : "Resume fiber"}
                </button>
              ) : (
                <button type="button" className="as-btn as-btn--secondary" disabled={!onPause || busy !== null || !PAUSABLE.has(status)} onClick={() => void run("pause", onPause)}>
                  {busy === "pause" ? "Pausing…" : "Pause fiber"}
                </button>
              )}
              {confirming ? (
                <div
                  className="as-confirm"
                  role="alertdialog"
                  aria-labelledby={`${headingId}-confirm`}
                  aria-describedby={`${headingId}-confirm-desc`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && busy !== "teardown") {
                      event.stopPropagation();
                      restoreTeardownFocus.current = true;
                      setConfirming(false);
                    }
                  }}
                >
                  <p className="as-confirm__title" id={`${headingId}-confirm`}>
                    Tear down this run?
                  </p>
                  <p className="as-confirm__body" id={`${headingId}-confirm-desc`}>
                    This terminates the VM and cancels all in-flight work. It cannot be undone.
                  </p>
                  <div className="as-confirm__actions">
                    <button
                      ref={cancelRef}
                      type="button"
                      className="as-btn as-btn--secondary"
                      disabled={busy === "teardown"}
                      onClick={() => {
                        restoreTeardownFocus.current = true;
                        setConfirming(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="button" className="as-btn as-btn--danger" disabled={busy === "teardown"} onClick={() => void run("teardown", onTeardown)}>
                      {busy === "teardown" ? "Tearing down…" : "Confirm teardown"}
                    </button>
                  </div>
                </div>
              ) : (
                <button ref={teardownRef} type="button" className="as-btn as-btn--danger" disabled={!onTeardown || final || busy !== null} onClick={() => setConfirming(true)}>
                  Emergency teardown
                </button>
              )}
            </div>
            {actionError ? (
              <p className="as-error-text" role="alert">
                {actionError}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}

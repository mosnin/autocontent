import { useEffect, useId, useRef, useState } from "react";
import { type HumanQuestion, readHumanQuestion } from "../hooks/use-approvals.ts";
import { cx, prettyValue } from "../internal/format.ts";
import { DiffView, diffFromArgs } from "./DiffView.tsx";
import type { ApprovalDecision, ApprovalRequest, ApprovalStatus } from "../types.ts";

export interface HumanOversightCardProps {
  approval: ApprovalRequest;
  /**
   * Submit the decision. While the returned promise is pending the card is
   * disabled; a rejection is shown inline and re-enables it. Resolve with
   * `{ status }` to show the server-confirmed final status immediately.
   */
  onDecide: (approval: ApprovalRequest, decision: ApprovalDecision, note?: string) => unknown;
  /**
   * Answer an `ask_person` question (`useApprovals().answer`). When omitted,
   * answers go through `onDecide`: confirm → approve/reject, choice/text →
   * `onDecide(approval, "approve", answer)`.
   */
  onAnswer?: (approval: ApprovalRequest, answer: string | boolean) => unknown;
  /** External in-flight state (e.g. from `useApprovals().pending`). */
  submitting?: ApprovalDecision | boolean;
  /** Offer an optional note field. Default `true`. */
  allowNote?: boolean;
  /** Heading. Default "Approval required". */
  title?: string;
  /** Tighter layout for chat bubbles and widgets. */
  compact?: boolean;
  className?: string;
}

const STATUS_COPY: Record<ApprovalStatus, string> = {
  PENDING_APPROVAL: "Awaiting decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

/** Maps free-form risk tier labels to a badge tone. */
export function riskTone(riskTier: string): "low" | "medium" | "high" | "critical" {
  const tier = riskTier.toLowerCase();
  if (/(crit|severe|sev-?0|p0|tier-?4|^4$)/.test(tier)) return "critical";
  if (/(high|danger|destructive|sev-?1|p1|tier-?3|^3$)/.test(tier)) return "high";
  if (/(med|moderate|sev-?2|p2|tier-?2|^2$)/.test(tier)) return "medium";
  return "low";
}

function statusFromResult(result: unknown): ApprovalStatus | undefined {
  if (typeof result !== "object" || result === null || !("status" in result)) return undefined;
  const status = (result as { status: unknown }).status;
  return status === "APPROVED" || status === "REJECTED" || status === "EXPIRED" || status === "PENDING_APPROVAL" ? status : undefined;
}

/**
 * Human-in-the-loop decision card: tool, risk tier, reason and arguments,
 * with approve/reject and an optional note. When the arguments carry a unified
 * diff (`args.diff` / `args.patch`), it is rendered with `DiffView`. Disabled
 * while a decision is submitting; shows the final status once decided. Questions from the
 * `ask_person` tool (`tool: "ask_person"`) render as a question card instead:
 * option buttons (choice), Yes/No (confirm) or a text box (text).
 */
export function HumanOversightCard(props: HumanOversightCardProps) {
  const question = readHumanQuestion(props.approval);
  return question ? <HumanQuestionCard {...props} question={question} /> : <ApprovalCard {...props} />;
}

function ApprovalCard({ approval, onDecide, submitting, allowNote = true, title = "Approval required", compact = false, className }: HumanOversightCardProps) {
  const headingId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [inFlight, setInFlight] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Scoped to the approval id so a reused card never shows another request's outcome.
  const [local, setLocal] = useState<{ approvalId: string; status: ApprovalStatus } | null>(null);
  const localStatus = local?.approvalId === approval.approvalId ? local.status : null;
  const statusRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const status: ApprovalStatus = approval.status !== "PENDING_APPROVAL" ? approval.status : (localStatus ?? "PENDING_APPROVAL");
  const decided = status !== "PENDING_APPROVAL";
  const busyDecision: ApprovalDecision | null = inFlight ?? (submitting === "approve" || submitting === "reject" ? submitting : null);
  const busy = busyDecision !== null || submitting === true;
  const tone = riskTone(approval.riskTier);
  // Code-change approvals (merge_to_main, push_branch, …) carry a unified diff: show it, not just raw JSON.
  const diff = diffFromArgs(approval.args);

  // The clicked button unmounts when the outcome renders; move focus to the
  // outcome so keyboard and screen-reader users are not dropped to <body>.
  const focusOutcome = useRef(false);
  useEffect(() => {
    if (decided && focusOutcome.current) {
      focusOutcome.current = false;
      statusRef.current?.focus();
    }
  }, [decided]);

  const decide = async (decision: ApprovalDecision) => {
    if (busy || decided) return;
    setInFlight(decision);
    setError(null);
    try {
      const result = await onDecide(approval, decision, allowNote && note.trim() ? note.trim() : undefined);
      if (!mounted.current) return;
      focusOutcome.current = true;
      setLocal({ approvalId: approval.approvalId, status: statusFromResult(result) ?? (decision === "approve" ? "APPROVED" : "REJECTED") });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setInFlight(null);
    }
  };

  return (
    <section
      className={cx("as-oversight", `as-oversight--${status.toLowerCase().replace("_approval", "")}`, compact && "as-oversight--compact", className)}
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-status={status}
    >
      <header className="as-oversight__header">
        <span className="as-oversight__icon" aria-hidden="true">
          ⚑
        </span>
        <h3 className="as-oversight__title" id={headingId}>
          {title}
        </h3>
        <span className={`as-risk as-risk--${tone}`}>
          <span className="as-sr-only">Risk tier: </span>
          {approval.riskTier}
        </span>
      </header>

      <dl className="as-oversight__facts">
        <div>
          <dt>Tool</dt>
          <dd>
            <code>{approval.tool}</code>
          </dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{approval.reason}</dd>
        </div>
      </dl>

      {diff ? <DiffView patch={diff} title="Proposed changes" className="as-oversight__diff" /> : null}

      <details className="as-oversight__args" open={!compact && !diff}>
        <summary>Arguments</summary>
        <pre tabIndex={0} aria-label="Tool arguments">
          {prettyValue(approval.args) || "(none)"}
        </pre>
      </details>

      {decided ? (
        <p className={`as-oversight__outcome as-oversight__outcome--${status.toLowerCase()}`} role="status" tabIndex={-1} ref={statusRef}>
          {STATUS_COPY[status]}
        </p>
      ) : (
        <>
          {allowNote ? (
            <div className="as-field">
              <label htmlFor={noteId}>Note (optional)</label>
              <textarea id={noteId} className="as-input" rows={2} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
            </div>
          ) : null}
          {error ? (
            <p className="as-error-text" role="alert">
              {error}
            </p>
          ) : null}
          <div className="as-oversight__actions">
            <button type="button" className="as-btn as-btn--danger" disabled={busy} onClick={() => void decide("reject")}>
              {busyDecision === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button type="button" className="as-btn as-btn--primary" disabled={busy} onClick={() => void decide("approve")}>
              {busyDecision === "approve" ? "Approving…" : "Approve"}
            </button>
          </div>
          <p className="as-sr-only" role="status">
            {busy ? "Submitting decision…" : ""}
          </p>
        </>
      )}
    </section>
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Question card for `ask_person` (choice / confirm / text). */
function HumanQuestionCard({ approval, question, onDecide, onAnswer, submitting, title = "Your agent has a question", compact = false, className }: HumanOversightCardProps & { question: HumanQuestion }) {
  const headingId = useId();
  const textId = useId();
  const [text, setText] = useState("");
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<{ approvalId: string; answer: string } | null>(null);
  const mounted = useMounted();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const localAnswer = local?.approvalId === approval.approvalId ? local.answer : null;
  const answered = question.answer ?? localAnswer;
  const expired = approval.status === "EXPIRED";
  const decided = expired || answered !== null || approval.status !== "PENDING_APPROVAL";
  const busy = inFlight !== null || submitting === true || submitting === "approve" || submitting === "reject";

  const focusOutcome = useRef(false);
  useEffect(() => {
    if (decided && focusOutcome.current) {
      focusOutcome.current = false;
      statusRef.current?.focus();
    }
  }, [decided]);

  const submit = async (value: string | boolean, label: string) => {
    if (busy || decided) return;
    setInFlight(label);
    setError(null);
    try {
      if (onAnswer) await onAnswer(approval, value);
      else if (question.kind === "confirm") await onDecide(approval, value === true ? "approve" : "reject");
      else await onDecide(approval, "approve", String(value));
      if (!mounted.current) return;
      focusOutcome.current = true;
      setLocal({ approvalId: approval.approvalId, answer: typeof value === "boolean" ? (value ? "yes" : "no") : value });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setInFlight(null);
    }
  };

  const outcome = expired ? "Expired" : answered !== null ? `Answered: ${question.kind === "confirm" ? (answered === "yes" ? "Yes" : answered === "no" ? "No" : answered) : answered}` : "Answered";

  return (
    <section
      className={cx("as-oversight", "as-oversight--question", decided && `as-oversight--${expired ? "expired" : "approved"}`, compact && "as-oversight--compact", className)}
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-status={expired ? "EXPIRED" : decided ? "ANSWERED" : "PENDING"}
    >
      <header className="as-oversight__header">
        <span className="as-oversight__icon" aria-hidden="true">
          ?
        </span>
        <h3 className="as-oversight__title" id={headingId}>
          {title}
        </h3>
      </header>
      <p className="as-oversight__question">{question.question}</p>

      {decided ? (
        <p className={`as-oversight__outcome as-oversight__outcome--${expired ? "expired" : "approved"}`} role="status" tabIndex={-1} ref={statusRef}>
          {outcome}
        </p>
      ) : (
        <>
          {question.kind === "text" ? (
            <form
              className="as-field"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) void submit(text.trim(), "text");
              }}
            >
              <label htmlFor={textId}>Your answer</label>
              <textarea id={textId} className="as-input" rows={3} maxLength={2000} value={text} placeholder={question.placeholder} disabled={busy} onChange={(event) => setText(event.target.value)} />
              <div className="as-oversight__actions">
                <button type="submit" className="as-btn as-btn--primary" disabled={busy || !text.trim()}>
                  {inFlight === "text" ? "Sending…" : "Send answer"}
                </button>
              </div>
            </form>
          ) : (
            <div className="as-oversight__actions" role="group" aria-label="Answers">
              {question.kind === "confirm" ? (
                <>
                  <button type="button" className="as-btn as-btn--secondary" disabled={busy} onClick={() => void submit(false, "no")}>
                    {inFlight === "no" ? "Sending…" : "No"}
                  </button>
                  <button type="button" className="as-btn as-btn--primary" disabled={busy} onClick={() => void submit(true, "yes")}>
                    {inFlight === "yes" ? "Sending…" : "Yes"}
                  </button>
                </>
              ) : (
                (question.options ?? []).map((option) => (
                  <button key={option} type="button" className="as-btn as-btn--secondary" disabled={busy} onClick={() => void submit(option, option)}>
                    {inFlight === option ? "Sending…" : option}
                  </button>
                ))
              )}
            </div>
          )}
          {error ? (
            <p className="as-error-text" role="alert">
              {error}
            </p>
          ) : null}
          <p className="as-sr-only" role="status">
            {busy ? "Sending answer…" : ""}
          </p>
        </>
      )}
    </section>
  );
}

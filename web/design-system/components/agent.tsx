"use client";

/**
 * Agent surfaces, from ref 02 (chat + agent panel + plan), ref 06 (question
 * card) and ref 01 (home composer). These are the product: talking to
 * Marketer. Every agent UI uses them.
 */
import { ArrowUp, ChevronDown, ChevronRight, ChevronUp, Plus, Square, ThumbsDown, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { decideInboxItem, type InboxKind } from "@/lib/workspace";
import { cx } from "../cx";
import { useAllowed } from "./access";
import { Notice, usePending } from "./kit";
import { AgentGlyph, Button, IconButton, NumberKey, StepMark, Textarea, type ToolTone } from "./primitives";
import { CommitWave } from "./wave";

/* ------------------------------------------------------------ Composer */

export interface ComposerAgent {
  name: string;
  note: string;
  tone?: ToolTone;
}

/**
 * Ref 02: a header strip naming who answers ("Orchestrator · Routes each
 * request"), the input, then "+" on the left and the model picker + round send
 * button on the right. `size="hero"` is the larger home composer (ref 01).
 */
export function Composer({
  agent,
  agentPicker,
  placeholder = "Ask anything or @ to add context",
  onSubmit,
  busy,
  onStop,
  disabled,
  size = "chat",
  modelLabel,
  autoFocus,
  className,
}: {
  agent: ComposerAgent;
  /** Replaces the header strip's agent with a picker (a MenuButton). */
  agentPicker?: ReactNode;
  placeholder?: string;
  onSubmit: (text: string) => void;
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  size?: "chat" | "hero";
  modelLabel?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(220, Math.max(size === "hero" ? 64 : 40, el.scrollHeight))}px`;
  }, [value, size]);
  const send = () => {
    const t = value.trim();
    if (!t || busy || disabled) return;
    onSubmit(t);
    setValue("");
  };
  return (
    <div className={cx("rounded-ds-xl border border-hairline bg-surface transition-colors focus-within:border-fg-faint", className)}>
      <div className="flex h-8 items-center gap-2 border-b border-hairline px-3 text-[12px]">
        {agentPicker ?? (
          <>
            <AgentGlyph size={14} tone={agent.tone} />
            <span className="font-medium text-fg">{agent.name}</span>
            <span className="text-fg-faint">{agent.note}</span>
          </>
        )}
      </div>
      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        aria-label="Message"
        className={cx("block w-full resize-none bg-transparent px-3.5 outline-none focus-visible:outline-none placeholder:text-fg-faint disabled:opacity-60", size === "hero" ? "pt-3.5 text-[15px]" : "pt-3 text-[13.5px]")}
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
        <button type="button" aria-label="Add context" title="Add context" className="ds-press flex size-7 items-center justify-center rounded-ds-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
          <Plus className="size-4" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          {modelLabel}
          {busy && onStop ? (
            <button type="button" onClick={onStop} aria-label="Stop" title="Stop" className="ds-press flex size-7 items-center justify-center rounded-full bg-ds-primary text-ds-primary-fg">
              <Square className="size-2.5 fill-current" />
            </button>
          ) : (
            <button type="button" onClick={send} disabled={!value.trim() || disabled} aria-label="Send" title="Send" className="ds-press flex size-7 items-center justify-center rounded-full bg-ds-primary text-ds-primary-fg disabled:bg-surface-3 disabled:text-fg-faint">
              <ArrowUp className="size-3.5" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Messages */

/** Ref 02 "Desire-driven": the user's message, right-aligned in a soft pill. */
export function UserBubble({ children, to }: { children: ReactNode; to?: ReactNode }) {
  return (
    <div className="ds-enter flex flex-col items-end gap-1">
      {to && <span className="text-[11.5px] text-fg-faint">{to}</span>}
      <div className="max-w-[80%] whitespace-pre-wrap rounded-ds-bubble bg-surface-3 px-3.5 py-2 text-[13.5px]">{children}</div>
    </div>
  );
}

/** Ref 02 "◎ Orchestrator": who is speaking. */
export function AssistantHeader({ name, tone, meta }: { name: string; tone?: ToolTone; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <AgentGlyph size={18} tone={tone} />
      <span className="text-[13px] font-medium">{name}</span>
      {meta && <span className="text-[12px] text-fg-faint">{meta}</span>}
    </div>
  );
}

/** Ref 02 "› Worked for 3m38s": collapsed trace of what the agent did. */
export function WorkedFor({ label, running, children, defaultOpen }: { label: string; running?: boolean; children?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg">
        <ChevronRight className={cx("size-3.5 transition-transform duration-200", open && "rotate-90")} />
        <span className={running ? "ds-shimmer" : undefined}>{label}</span>
      </button>
      {open && children && <div className="ds-enter mt-2 pl-5">{children}</div>}
    </div>
  );
}

/** Ref 02 "Agent is working": who is on it, as pill chips. */
export function AgentChips({ label = "Agent is working", agents, activeName, onSelect }: { label?: string; agents: { name: string; tone?: ToolTone }[]; activeName?: string; onSelect?: (name: string) => void }) {
  if (agents.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-[12px] text-fg-faint">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => onSelect?.(a.name)}
            className={cx("ds-press flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px]", activeName === a.name ? "border-hairline-strong bg-surface-3 text-fg" : "border-hairline bg-surface text-fg-muted hover:text-fg")}
          >
            <AgentGlyph size={14} tone={a.tone} />
            {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Message feedback */

/**
 * Thumbs on an assistant reply, with an optional comment. A thumb sends the
 * rating at once; "Add a comment" then sends it again with the text. The owner
 * decides where it goes (`onRate` resolves when saved, throws with a message
 * a person can read when not). Quiet by design: faint until hovered or used.
 */
export function MessageFeedback({ onRate, maxComment = 1000 }: { onRate: (score: 0 | 1, comment?: string) => Promise<void>; maxComment?: number }) {
  const [score, setScore] = useState<0 | 1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [comment, setComment] = useState("");
  const [commented, setCommented] = useState(false);
  const commentId = useId();

  async function rate(next: 0 | 1, text?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRate(next, text);
      setScore(next);
      if (text) {
        setCommented(true);
        setWriting(false);
        setComment("");
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Your rating wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Rate this reply" className="flex items-center gap-0.5">
        <IconButton label="Good reply" aria-pressed={score === 1} active={score === 1} disabled={busy} onClick={() => void rate(1)}>
          <ThumbsUp />
        </IconButton>
        <IconButton label="Bad reply" aria-pressed={score === 0} active={score === 0} disabled={busy} onClick={() => void rate(0)}>
          <ThumbsDown />
        </IconButton>
        {score !== null && !writing && (
          <span role="status" className="ds-enter ml-1.5 flex items-center gap-2 text-[12px] text-fg-muted">
            {commented ? "Thanks, your comment was sent." : "Thanks."}
            {!commented && (
              <button type="button" className="text-ds-accent hover:underline" onClick={() => setWriting(true)}>
                Add a comment
              </button>
            )}
          </span>
        )}
      </div>
      {writing && score !== null && (
        <form
          className="ds-enter space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) void rate(score, comment.trim());
          }}
        >
          <label htmlFor={commentId} className="block text-[12px] text-fg-muted">
            What should Marketer know about this reply? Don&apos;t include passwords or card numbers.
          </label>
          <Textarea id={commentId} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={maxComment} rows={3} className="w-full" autoFocus />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!comment.trim()}>
              Send
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)} disabled={busy}>
              Cancel
            </Button>
            <span className="ml-auto text-[11.5px] tabular text-fg-faint">
              {comment.length}/{maxComment}
            </span>
          </div>
        </form>
      )}
      {error && <Notice error={error} />}
    </div>
  );
}

/* ------------------------------------------------------------ Trace */

export interface TraceNode {
  id: string;
  label: ReactNode;
  state: "todo" | "active" | "done" | "failed";
  detail?: ReactNode;
}

/** Ref 02 right panel: a vertical timeline of steps, last done step checked. */
export function Trace({ nodes, limit = 6 }: { nodes: TraceNode[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? nodes : nodes.slice(-limit);
  return (
    <div>
      <ol className="relative space-y-2.5 before:absolute before:bottom-1.5 before:left-[6.5px] before:top-1.5 before:w-px before:bg-hairline">
        {shown.map((n) => (
          <li key={n.id} className="relative flex gap-2.5 text-[12.5px]">
            <span className="relative z-10 mt-[2px] bg-overlay">
              <StepMark state={n.state} />
            </span>
            <span className="min-w-0">
              <span className={cx(n.state === "todo" ? "text-fg-faint" : "text-fg-muted", n.state === "active" && "ds-shimmer")}>{n.label}</span>
              {n.detail && <span className="mt-1 block text-fg-faint">{n.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {nodes.length > limit && (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="mt-2 pl-6 text-[12px] text-fg-muted hover:text-fg">
          {all ? "show less" : `show ${nodes.length - limit} more`}
        </button>
      )}
    </div>
  );
}

/** Ref 02 "Searched": source chips with a favicon-ish initial. */
export function SourceChips({ sources, more }: { sources: string[]; more?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s) => (
        <span key={s} className="inline-flex h-6 items-center gap-1.5 rounded-ds-sm bg-surface-3 px-2 text-[11.5px] text-fg-muted">
          <span className="flex size-3.5 items-center justify-center rounded-ds-2xs bg-surface-2 text-[9px] font-semibold text-fg">{s.slice(0, 1).toUpperCase()}</span>
          {s}
        </span>
      ))}
      {more ? <span className="inline-flex h-6 items-center px-1 text-[11.5px] text-fg-faint">{more}+ more</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------ Plan card */

/**
 * Ref 02 "Run Creative Pipeline · 7 steps": an icon tile, title, step count,
 * a collapsible list of hollow-circle steps, then Dismiss / Edit / Approve & Run.
 */
export function PlanCard({
  title,
  icon,
  steps,
  meta,
  onApprove,
  onDismiss,
  onEdit,
  approving,
  dismissing,
  decided,
  approved,
  approveLabel = "Approve & Run",
  blocked,
  className,
}: {
  title: string;
  icon?: ReactNode;
  steps: { label: ReactNode; state?: "todo" | "active" | "done" | "failed" }[];
  meta?: ReactNode;
  onApprove?: () => void;
  onDismiss?: () => void;
  onEdit?: () => void;
  /** The approve request is in flight: its button spins, the others are disabled. */
  approving?: boolean;
  /** The dismiss request is in flight: its button spins, the others are disabled. */
  dismissing?: boolean;
  decided?: ReactNode;
  /**
   * Pass it (false while pending, true once the server accepted the approval) to give this card the
   * approve wave. Leave it undefined for cards that are not an "Approve & Run" (WAVE.md).
   */
  approved?: boolean;
  approveLabel?: string;
  /**
   * The person's role can't decide this (useAllowed said no): the buttons are
   * replaced by this one line, e.g. "Marketers and admins approve this." The
   * server refuses the decision anyway; this only keeps the UI honest.
   */
  blocked?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  // The approve wave (WAVE.md): only when the person pressed Approve on this card, here, and the server said yes.
  const approveBtn = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);
  const waves = approved !== undefined;
  const committed = waves && approved === true && pressed.current;
  const settled = Boolean(decided) && !committed;

  const head = (
    <>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-ds-sm text-[13px]" style={{ background: "var(--ds-tool-e)" }}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{title}</span>
        <span className="text-[12px] text-fg-faint">{meta ?? `${steps.length} steps`}</span>
      </div>
      <div className="border-t border-hairline px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg">
          <ChevronDown className={cx("size-3.5 transition-transform duration-200", !open && "-rotate-90")} /> Steps
        </button>
        {open && (
          <ol className="mt-2 space-y-2 pb-1">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-fg-muted">
                <span className="mt-[1px]">
                  <StepMark state={s.state ?? "todo"} />
                </span>
                <span className="min-w-0">{s.label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
  const buttons = (
    <>
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss} loading={dismissing} disabled={approving}>
          Dismiss
        </Button>
      )}
      {onEdit && (
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={approving || dismissing}>
          Edit
        </Button>
      )}
      {onApprove && (
        <Button
          ref={approveBtn}
          variant="primary"
          size="sm"
          onClick={() => {
            pressed.current = true;
            onApprove();
          }}
          loading={approving}
          disabled={dismissing}
        >
          {approveLabel}
        </Button>
      )}
    </>
  );
  const FOOT = "flex min-h-[45px] items-center justify-end gap-1.5 border-t border-hairline px-3 py-2";
  const verdict = (
    <span className="flex items-center gap-2 text-[12.5px] text-fg-muted">
      {approved && <StepMark state="done" />}
      {decided}
    </span>
  );

  if (blocked && !decided) {
    return (
      <div className={cx("ds-enter rounded-ds-lg border border-hairline bg-surface", className)}>
        {head}
        <div className={FOOT}>
          <span className="mr-auto text-[12.5px] text-fg-muted" data-testid="approval-blocked">
            {blocked}
          </span>
        </div>
      </div>
    );
  }

  if (!waves) {
    return (
      <div className={cx("ds-enter rounded-ds-lg border border-hairline bg-surface", className)}>
        {head}
        <div className={FOOT}>{decided ? verdict : buttons}</div>
      </div>
    );
  }
  // Both faces are the same card, so nothing moves: the wave passes and the buttons have become the verdict.
  return (
    <CommitWave
      moment="approve"
      committed={committed}
      source={approveBtn}
      className={cx("ds-enter border border-hairline", className)}
      action={committed || settled ? undefined : <div className="pointer-events-none flex h-full items-end justify-end px-3 py-2"><div className="pointer-events-auto flex min-h-7 items-center gap-1.5">{buttons}</div></div>}
      receipt={
        <div>
          {head}
          <div className={FOOT}>{verdict}</div>
        </div>
      }
    >
      <div>
        {head}
        <div className={FOOT}>{settled ? verdict : null}</div>
      </div>
    </CommitWave>
  );
}

/* ------------------------------------------------------------ Approval card */

/**
 * The one approval card: an inbox item (video, carousel, ad change) as a
 * PlanCard wired to the workspace decide endpoint. Dismiss rejects, Approve &
 * Run approves. While a request is in flight both buttons are locked, so a
 * double click can't decide twice; the server's refusal shows underneath.
 */
export function ApprovalCard({
  item,
  title,
  icon,
  steps,
  meta,
  onEdit,
  onDecided,
  focused,
  id,
  approveLabel,
}: {
  item: { kind: InboxKind; ref_id: string };
  title: string;
  icon?: ReactNode;
  steps: { label: ReactNode }[];
  meta?: ReactNode;
  onEdit?: () => void;
  onDecided?: (decision: "approve" | "reject") => void;
  /** Scroll to it and ring it (the inbox's `?focus=`). */
  focused?: boolean;
  id?: string;
  approveLabel?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  // Ad changes move money (spend:approve); videos and carousels are content (content:approve).
  const allowed = useAllowed(item.kind === "ad_change" ? "spend:approve" : "content:approve");
  const { busy, error, run } = usePending<"approve" | "reject">();
  const [done, setDone] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const decide = (d: "approve" | "reject") =>
    void run(d, async () => {
      await decideInboxItem(item, d);
      setDone(d);
      onDecided?.(d);
      router.refresh();
    });

  return (
    <div ref={ref} id={id} className={cx("rounded-ds-lg", focused && "ring-1 ring-ds-accent")}>
      <PlanCard
        title={title}
        icon={icon}
        meta={meta}
        steps={steps}
        approveLabel={approveLabel}
        onDismiss={() => decide("reject")}
        onEdit={onEdit}
        onApprove={() => decide("approve")}
        approving={busy === "approve"}
        dismissing={busy === "reject"}
        decided={done ? (done === "approve" ? "Approved" : "Dismissed") : undefined}
        approved={done === "approve"}
        blocked={allowed ? undefined : "Your role can view this but not approve it."}
      />
      {error && (
        <div className="px-1 pt-1.5">
          <Notice error={error} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Question card */

/**
 * Ref 06 "What you should do?": numbered answers (number keys pick), a
 * "Type it your own" row, and "↑ ↓ to navigate". Replaces the composer while
 * the agent waits on a person.
 */
export function QuestionCard({ title, options, onAnswer, allowOwn = true, answered, busy, placeholder = "Type it your own" }: { title: string; options: { label: string; description?: string }[]; onAnswer: (value: string, index: number) => void; allowOwn?: boolean; answered?: string; /** The answer is being sent: the options lock so it can't be sent twice. */ busy?: boolean; placeholder?: string }) {
  const [sel, setSel] = useState(0);
  const [own, setOwn] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const count = options.length + (allowOwn ? 1 : 0);
  useEffect(() => {
    if (answered || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Shortcuts work from the page or from inside the card, never from another control: Enter on a focused button elsewhere must stay that button's.
      if (t && t !== document.body && !ref.current?.contains(t)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t?.tagName === "TEXTAREA" || (t?.tagName === "INPUT" && t !== ref.current?.querySelector("input"))) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length && t?.tagName !== "INPUT") {
        e.preventDefault();
        onAnswer(options[n - 1]!.label, n - 1);
      }
      if (e.key === "ArrowDown") (e.preventDefault(), setSel((v) => Math.min(v + 1, count - 1)));
      if (e.key === "ArrowUp") (e.preventDefault(), setSel((v) => Math.max(v - 1, 0)));
      // Enter on a focused option is that button's own click; from the page it picks the highlighted one.
      if (e.key === "Enter" && t?.tagName !== "INPUT" && t?.tagName !== "BUTTON" && sel < options.length) (e.preventDefault(), onAnswer(options[sel]!.label, sel));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div ref={ref} role="group" aria-label={title} aria-busy={busy || undefined} className="ds-enter overflow-hidden rounded-ds-xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-4 py-3 text-[13.5px] font-medium">{title}</div>
      {answered ? (
        <div className="px-4 py-3 text-[13px] text-fg-muted">
          Answered: <span className="text-fg">{answered}</span>
        </div>
      ) : (
        <div className="p-1.5">
          {options.map((o, i) => (
            <button key={o.label} type="button" disabled={busy} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => onAnswer(o.label, i)} className={cx("flex h-10 w-full items-center gap-3 rounded-ds-md px-2.5 text-left -outline-offset-2 disabled:opacity-45", sel === i && "bg-surface-2")}>
              <NumberKey n={i + 1} />
              <span className="text-[13.5px] font-medium">{o.label}</span>
              {o.description && <span className="truncate text-[12.5px] text-fg-muted">{o.description}</span>}
            </button>
          ))}
          {allowOwn && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (own.trim() && !busy) onAnswer(own.trim(), -1);
              }}
              className={cx("flex h-10 items-center gap-3 rounded-ds-md px-2.5 focus-within:ring-1 focus-within:ring-inset focus-within:ring-ds-accent", sel === options.length && "bg-surface-2")}
            >
              <NumberKey n={options.length + 1} />
              <input value={own} onChange={(e) => setOwn(e.target.value)} onFocus={() => setSel(options.length)} disabled={busy} placeholder={placeholder} aria-label={placeholder} className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-faint" />
            </form>
          )}
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2 text-[12px] text-fg-faint">
            <ChevronUp aria-hidden className="size-3.5" />
            <ChevronDown aria-hidden className="size-3.5" /> to navigate
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Ask pill */

/** Ref 05 "✦ Ask Viictor": floating pill at the bottom centre of a dashboard. */
export function AskPill({ label, onClick, href }: { label: string; onClick?: () => void; href?: string }) {
  const cls = "ds-press pointer-events-auto flex h-8 items-center gap-2 rounded-full border border-hairline-strong bg-overlay px-3.5 text-[12.5px] font-medium text-fg shadow-ds-float hover:bg-surface-2";
  const inner = (
    <>
      <AgentGlyph size={14} tone="d" />
      {label}
    </>
  );
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
      {href ? (
        <a href={href} className={cls}>
          {inner}
        </a>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {inner}
        </button>
      )}
    </div>
  );
}

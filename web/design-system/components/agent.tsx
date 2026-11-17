"use client";

/**
 * Agent surfaces, from ref 02 (chat + agent panel + plan), ref 06 (question
 * card) and ref 01 (home composer). These are the product: talking to
 * Marketer. Every agent UI uses them.
 */
import { ArrowUp, ChevronDown, ChevronRight, ChevronUp, Plus, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "../cx";
import { AgentGlyph, Button, NumberKey, StepMark, type ToolTone } from "./primitives";

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
    <div className={cx("rounded-ds-xl border border-hairline bg-surface transition-colors focus-within:border-hairline-strong", className)}>
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
      <div className="max-w-[80%] whitespace-pre-wrap rounded-[18px] bg-surface-3 px-3.5 py-2 text-[13.5px]">{children}</div>
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
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 pl-6 text-[12px] text-fg-faint hover:text-fg">
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
          <span className="flex size-3.5 items-center justify-center rounded-[3px] bg-surface-2 text-[9px] font-semibold text-fg">{s.slice(0, 1).toUpperCase()}</span>
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
  decided,
  approveLabel = "Approve & Run",
}: {
  title: string;
  icon?: ReactNode;
  steps: { label: ReactNode; state?: "todo" | "active" | "done" | "failed" }[];
  meta?: ReactNode;
  onApprove?: () => void;
  onDismiss?: () => void;
  onEdit?: () => void;
  approving?: boolean;
  decided?: ReactNode;
  approveLabel?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ds-enter rounded-ds-lg border border-hairline bg-surface">
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
      <div className="flex items-center justify-end gap-1.5 border-t border-hairline px-3 py-2">
        {decided ? (
          <span className="text-[12.5px] text-fg-muted">{decided}</span>
        ) : (
          <>
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss} disabled={approving}>
                Dismiss
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit} disabled={approving}>
                Edit
              </Button>
            )}
            {onApprove && (
              <Button variant="primary" size="sm" onClick={onApprove} loading={approving}>
                {approveLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Question card */

/**
 * Ref 06 "What you should do?": numbered answers (number keys pick), a
 * "Type it your own" row, and "↑ ↓ to navigate". Replaces the composer while
 * the agent waits on a person.
 */
export function QuestionCard({ title, options, onAnswer, allowOwn = true, answered, placeholder = "Type it your own" }: { title: string; options: { label: string; description?: string }[]; onAnswer: (value: string, index: number) => void; allowOwn?: boolean; answered?: string; placeholder?: string }) {
  const [sel, setSel] = useState(0);
  const [own, setOwn] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const count = options.length + (allowOwn ? 1 : 0);
  useEffect(() => {
    if (answered) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === "TEXTAREA" || (t?.tagName === "INPUT" && t !== ref.current?.querySelector("input"))) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length && t?.tagName !== "INPUT") {
        e.preventDefault();
        onAnswer(options[n - 1]!.label, n - 1);
      }
      if (e.key === "ArrowDown") (e.preventDefault(), setSel((v) => Math.min(v + 1, count - 1)));
      if (e.key === "ArrowUp") (e.preventDefault(), setSel((v) => Math.max(v - 1, 0)));
      if (e.key === "Enter" && t?.tagName !== "INPUT" && sel < options.length) (e.preventDefault(), onAnswer(options[sel]!.label, sel));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div ref={ref} className="ds-enter overflow-hidden rounded-ds-xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-4 py-3 text-[13.5px] font-medium">{title}</div>
      {answered ? (
        <div className="px-4 py-3 text-[13px] text-fg-muted">
          Answered: <span className="text-fg">{answered}</span>
        </div>
      ) : (
        <div className="p-1.5">
          {options.map((o, i) => (
            <button key={o.label} type="button" onMouseEnter={() => setSel(i)} onClick={() => onAnswer(o.label, i)} className={cx("flex h-10 w-full items-center gap-3 rounded-ds-md px-2.5 text-left", sel === i && "bg-surface-2")}>
              <NumberKey n={i + 1} />
              <span className="text-[13.5px] font-medium">{o.label}</span>
              {o.description && <span className="truncate text-[12.5px] text-fg-faint">{o.description}</span>}
            </button>
          ))}
          {allowOwn && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (own.trim()) onAnswer(own.trim(), -1);
              }}
              className={cx("flex h-10 items-center gap-3 rounded-ds-md px-2.5", sel === options.length && "bg-surface-2")}
            >
              <NumberKey n={options.length + 1} />
              <input value={own} onChange={(e) => setOwn(e.target.value)} onFocus={() => setSel(options.length)} placeholder={placeholder} aria-label={placeholder} className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-faint" />
            </form>
          )}
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2 text-[12px] text-fg-faint">
            <ChevronUp className="size-3.5" />
            <ChevronDown className="size-3.5" /> to navigate
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

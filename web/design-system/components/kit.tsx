"use client";

/**
 * Kit: the smaller working parts every page needs (chips, notices, copy,
 * code, secrets, meters, tags, confirm, tables, media). Same tokens as the
 * primitives. See ../README.md for where each one is used.
 */
import { AlertCircle, Check, Copy, X } from "lucide-react";
import Link from "next/link";
import { type InputHTMLAttributes, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cx } from "../cx";
import { Button, inputClass, Modal, StepMark, ToolIcon, type ToolTone } from "./primitives";

/* -------------------------------------------------------------- Chip */

/** Selectable pill (ref 03 prompt pills, ref 01 suggestion row). Not a status. */
/**
 * A selectable pill (ref 03 prompts). `quiet` drops the border and fill until
 * selected: use it for a row of section links (Admin), where eight bordered
 * pills read as eight buttons.
 */
export function Chip({ selected, onClick, href, icon, children, className, quiet }: { selected?: boolean; onClick?: () => void; href?: string; icon?: ReactNode; children: ReactNode; className?: string; quiet?: boolean }) {
  const cls = cx(
    "ds-press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] [&_svg]:size-3.5",
    quiet
      ? selected
        ? "bg-surface-3 font-medium text-fg"
        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      : cx("border", selected ? "border-hairline-strong bg-surface-3 text-fg" : "border-hairline bg-surface-2 text-fg-muted hover:border-hairline-strong hover:text-fg"),
    className,
  );
  if (href)
    return (
      <Link href={href} aria-current={selected ? "page" : undefined} className={cls}>
        {icon}
        {children}
      </Link>
    );
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cls}>
      {icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- Notices */

/**
 * One line after a save or a failure. Text only, no box. `inline` renders a
 * span, for places a paragraph can't go (beside a button, inside a row).
 */
export function Notice({ ok, error, inline }: { ok?: string | null; error?: string | null; inline?: boolean }) {
  const As = inline ? "span" : "p";
  if (error)
    return (
      <As role="alert" className={cx("items-center gap-1.5 text-[12.5px] text-negative", inline ? "inline-flex" : "flex")}>
        <AlertCircle aria-hidden className="size-3.5 shrink-0" />
        {error}
      </As>
    );
  if (ok)
    return (
      <As role="status" className={cx("ds-enter items-center gap-1.5 text-[12.5px] text-positive", inline ? "inline-flex" : "flex")}>
        <Check aria-hidden className="size-3.5 shrink-0" />
        {ok}
      </As>
    );
  return null;
}

/** A quiet bordered callout for one important sentence (e.g. "Agents can't spend until…"). */
export function Callout({ tone = "neutral", icon, title, children, action }: { tone?: "neutral" | "attention" | "negative"; icon?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-ds-lg border bg-surface px-3.5 py-3 text-[13px]", tone === "neutral" && "border-hairline", tone === "attention" && "border-attention/35", tone === "negative" && "border-negative/35")}>
      {icon && <span className={cx("mt-px flex [&_svg]:size-4", tone === "attention" ? "text-attention" : tone === "negative" ? "text-negative" : "text-fg-muted")}>{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-fg">{title}</div>}
        {children && <div className={cx("text-fg-muted", title ? "mt-0.5" : undefined)}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- Copy, code, secrets */

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      <span className="sr-only sm:not-sr-only">{done ? "Copied" : label}</span>
    </Button>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cx("relative min-w-0 rounded-ds-md border border-hairline bg-surface-2", className)}>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 pr-24 font-mono text-[12px] leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A secret shown once (token, signing secret). */
export function SecretOnce({ label, value, children, onDismiss }: { label: string; value: string; children?: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="ds-enter space-y-2.5 rounded-ds-lg border border-attention/35 bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        {onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            I've stored it
          </Button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-ds-sm border border-hairline bg-surface-2 px-2.5 py-1">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px]">{value}</code>
        <CopyButton text={value} />
      </div>
      {children && <div className="text-[12.5px] text-fg-muted">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- Inputs */

export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-fg-faint">$</span>
      <input type="number" min="0" step="0.01" inputMode="decimal" {...props} className={cx(inputClass, "h-8 pl-6 tabular", props.className)} />
    </div>
  );
}

export function TagInput({ id, values, onChange, placeholder, prefix = "" }: { id: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string; prefix?: string }) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().replace(/^#+/, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange(Array.from(new Set([...values, ...parts])));
    setDraft("");
  };
  return (
    <div className={cx(inputClass, "flex min-h-8 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:border-ds-accent focus-within:ring-2 focus-within:ring-ds-accent/20")}>
      {values.map((t) => (
        <span key={t} className="inline-flex h-5 items-center gap-1 rounded-ds-xs bg-surface-3 pl-1.5 pr-0.5 text-[12px]">
          {prefix}
          {t}
          <button type="button" aria-label={`Remove ${prefix}${t}`} className="flex size-4 items-center justify-center rounded-ds-xs text-fg-faint hover:text-fg" onClick={() => onChange(values.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-[110px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-fg-faint"
        placeholder={values.length === 0 ? placeholder : ""}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) commit(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) onChange(values.slice(0, -1));
        }}
        onBlur={() => draft && commit(draft)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- Meter */

/** Thin bar (budget pacing, quota). */
export function Meter({ value, tone = "accent", label }: { value: number; tone?: "accent" | "attention" | "negative"; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone === "accent" && "bg-ds-accent", tone === "attention" && "bg-attention", tone === "negative" && "bg-negative")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------- Confirm */

export function ConfirmModal({ open, onClose, title, children, confirmLabel, onConfirm, danger, busy, disabled, error }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; confirmLabel: string; onConfirm: () => void; danger?: boolean; busy?: boolean; disabled?: boolean; error?: string | null }) {
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} disabled={disabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-fg-muted">{children}</div>
      {error && <div className="mt-3"><Notice error={error} /></div>}
    </Modal>
  );
}

/* -------------------------------------------------------------- Table */
/* Data rows (ref 05 bar list rows, ref 03 app rows): 13px, hairline dividers,
   muted 12px header, numbers right-aligned and tabular. */

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
  hideOnPhone?: boolean;
}

export function Table<T>({ columns, rows, rowKey, rowHref, empty, pageSize = 50, noun = "rows" }: { columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string; rowHref?: (row: T) => string | undefined; empty?: ReactNode; /** Rows rendered before "Load more". A table never renders an unbounded list. */ pageSize?: number; noun?: string }) {
  const page = usePaged(rows, pageSize);
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="space-y-3">
    <div className="overflow-x-auto rounded-ds-lg border border-hairline bg-surface">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-hairline text-[12px] text-fg-faint">
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined} className={cx("h-8 px-3.5 font-normal", c.align === "right" ? "text-right" : "text-left", c.hideOnPhone && "hidden md:table-cell")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {page.shown.map((r) => {
            const href = rowHref?.(r);
            return (
              <tr key={rowKey(r)} className={cx(href && "relative hover:bg-surface-2")}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cx("h-11 px-3.5", c.align === "right" ? "text-right tabular" : "text-left", c.hideOnPhone && "hidden md:table-cell")}>
                    {href && i === 0 ? (
                      <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ds-accent">
                        {c.render(r)}
                      </Link>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      <LoadMore shown={page.shown.length} total={page.total} onMore={page.more} noun={noun} />
    </div>
  );
}

/* -------------------------------------------------------------- Media */

/** A media thumbnail (video/image/carousel) at a fixed ratio. Placeholder is a flat surface. */
export function Thumb({ src, alt = "", ratio = "9/16", children, className }: { src?: string | null; alt?: string; ratio?: "9/16" | "1/1" | "16/9" | "4/5"; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-ds-md border border-hairline bg-surface-2", className)} style={{ aspectRatio: ratio }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : null}
      {children}
    </div>
  );
}

/** Loading placeholder: a flat block with one soft band passing over it. A block-level span, so it can stand in for text inside a heading or paragraph. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("ds-skeleton block rounded-ds-sm", className)} />;
}

/** Key/value rows (detail pages: "Status · Live", "Budget · $40/day"). */
export function Facts({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-hairline rounded-ds-lg border border-hairline bg-surface">
      {items.map((it, i) => (
        <div key={i} className="flex min-h-10 items-center justify-between gap-4 px-3.5 py-2 text-[13px]">
          <dt className="text-fg-muted">{it.label}</dt>
          <dd className="min-w-0 truncate text-right text-fg tabular">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------- Time */

/**
 * A timestamp. Server and browser can disagree about it (time zone, "now"), so:
 * - `mode` ("relative" | "datetime") renders at once and lets hydration differ;
 * - `format` renders in the viewer's time zone after mount, when the exact
 *   local clock time matters ("Tue 9:00 AM").
 */
export function Time({ iso, mode = "relative", format, className }: { iso: string | null | undefined; mode?: "relative" | "datetime"; format?: Intl.DateTimeFormatOptions; className?: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (iso && format) setLocal(new Date(iso).toLocaleString("en-US", format));
  }, [iso, format]);
  if (!iso) return null;
  if (format)
    return (
      <time dateTime={iso} suppressHydrationWarning className={className}>
        {local ?? " "}
      </time>
    );
  return (
    <time dateTime={iso} suppressHydrationWarning className={className} title={formatDateTime(iso)}>
      {mode === "relative" ? formatRelative(iso) : formatDateTime(iso)}
    </time>
  );
}

/* -------------------------------------------------------------- Tool pages */

/** Tool page title (README §5 Tool): the tool's coloured icon beside the 22px title. Icon and tone come from `TOOL_ICON`. */
export function ToolTitle({ icon, tone, children }: { icon: ReactNode; tone: ToolTone; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <ToolIcon tone={tone} size={22}>
        {icon}
      </ToolIcon>
      {children}
    </span>
  );
}

/** A quiet line of numbers under the composer: "$3.20 of $15 today · 2 need approval". */
export function StatLine({ items }: { items: { label: string; value: ReactNode; tone?: "attention" }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <dd className={cx("font-medium tabular", it.tone === "attention" ? "text-attention" : "text-fg")}>{it.value}</dd>
          <dt className="text-fg-muted">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A pipeline as plan-card steps (ref 02): filled check for done, spinner on the current step. */
export function StepList({ steps, current, complete, failed }: { steps: { id: string; label: string; detail?: string }[]; current: number; complete?: boolean; failed?: boolean }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const done = complete || i < current;
        const now = !complete && i === current;
        return (
          <li key={s.id} className="flex items-start gap-2.5 text-[13px]" aria-current={now ? "step" : undefined}>
            <span className="mt-[2px] flex">
              <StepMark state={done ? "done" : now ? (failed ? "failed" : "active") : "todo"} />
            </span>
            <span className="min-w-0">
              <span className={cx(done || now ? "text-fg" : "text-fg-muted")}>{s.label}</span>
              {now && <span className={cx("ml-2 text-[12px]", failed ? "text-negative" : "text-fg-muted")}>{failed ? "Stopped here" : "Working"}</span>}
              {s.detail && <span className="block text-[12px] text-fg-muted">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------- Long lists */

/**
 * Cap a long client-side list: show `pageSize` rows, then `pageSize` more per
 * "Load more". Resets when `resetKey` changes or the list gets much shorter.
 */
export function usePaged<T>(items: T[], pageSize = 24, resetKey?: unknown): { shown: T[]; total: number; hasMore: boolean; more: () => void } {
  const [limit, setLimit] = useState(pageSize);
  // A different list (another tab or filter) starts from the first page again.
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  useEffect(() => {
    setLimit((l) => (items.length < l - pageSize ? pageSize : l));
  }, [items.length, pageSize]);
  return { shown: items.length > limit ? items.slice(0, limit) : items, total: items.length, hasMore: items.length > limit, more: () => setLimit((l) => l + pageSize) };
}

/** The foot of a capped list: "Showing 24 of 180" and a Load more button. Renders nothing when everything is shown. */
export function LoadMore({ shown, total, onMore, noun = "items" }: { shown: number; total: number; onMore: () => void; noun?: string }) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-1">
      <span className="text-[12px] text-fg-muted tabular" aria-live="polite">
        Showing {shown} of {total} {noun}
      </span>
      <Button size="sm" onClick={onMore}>
        Load more
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- Pending actions */

/**
 * Double-submit protection for anything that approves, rejects, publishes or
 * spends. `run(key, fn)` ignores a second call while the first is in flight
 * (a ref, so two clicks in one frame can't both pass), exposes which action is
 * `busy` for the button's `loading`/`disabled`, and keeps the server's message
 * in `error` for a `Notice`.
 */
export function usePending<K extends string = string>() {
  const lock = useRef(false);
  const [busy, setBusy] = useState<K | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: K, fn: () => Promise<unknown>): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }, []);
  return { busy, error, run, setError };
}

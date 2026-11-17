"use client";

/**
 * Kit: the smaller working parts every page needs (chips, notices, copy,
 * code, secrets, meters, tags, confirm, tables, media). Same tokens as the
 * primitives. See ../README.md for where each one is used.
 */
import { AlertCircle, Check, Copy, X } from "lucide-react";
import Link from "next/link";
import { type InputHTMLAttributes, type ReactNode, useState } from "react";
import { cx } from "../cx";
import { Button, inputClass, Modal } from "./primitives";

/* -------------------------------------------------------------- Chip */

/** Selectable pill (ref 03 prompt pills, ref 01 suggestion row). Not a status. */
export function Chip({ selected, onClick, href, icon, children, className }: { selected?: boolean; onClick?: () => void; href?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  const cls = cx(
    "ds-press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] [&_svg]:size-3.5",
    selected ? "border-hairline-strong bg-surface-3 text-fg" : "border-hairline bg-surface-2 text-fg-muted hover:border-hairline-strong hover:text-fg",
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls}>
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

/** One line under a form after save / failure. Text only, no box. */
export function Notice({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error)
    return (
      <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-negative">
        <AlertCircle className="size-3.5 shrink-0" />
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="ds-enter flex items-center gap-1.5 text-[12.5px] text-positive">
        <Check className="size-3.5 shrink-0" />
        {ok}
      </p>
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

export function Table<T>({ columns, rows, rowKey, rowHref, empty }: { columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string; rowHref?: (row: T) => string | undefined; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
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
          {rows.map((r) => {
            const href = rowHref?.(r);
            return (
              <tr key={rowKey(r)} className={cx(href && "relative hover:bg-surface-2")}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cx("h-11 px-3.5", c.align === "right" ? "text-right tabular" : "text-left", c.hideOnPhone && "hidden md:table-cell")}>
                    {href && i === 0 ? (
                      <Link href={href} className="after:absolute after:inset-0">
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

/** Loading placeholder: a flat block that shimmers once per second. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("ds-shimmer rounded-ds-sm bg-surface-2", className)} />;
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

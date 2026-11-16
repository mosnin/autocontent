"use client";

/**
 * Small primitives the business pages (paid media, distribution, brand,
 * integrations, settings) share. Candidates for promotion into ui.tsx.
 */
import { Check, Copy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type InputHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { Button, cx, inputCls, Modal } from "../ui";

/** A confirm dialog: one sentence, a primary (or danger) confirm, a quiet cancel. */
export function ConfirmModal({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  danger,
  busy,
  disabled,
  error,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <div className="space-y-4 text-[14px] text-muted-foreground">{children}</div>
      {error && <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} disabled={disabled}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** Copy-to-clipboard icon button that ticks for a moment. */
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

/** A mono code block with a copy button. Scrolls inside itself, never the page. */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cx("relative min-w-0 rounded-[14px] bg-subtle shadow-[inset_0_0_0_1px_hsl(var(--border))]", className)}>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 pr-24 font-mono text-[12.5px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A secret shown once (token, signing secret): mono, copyable, with a note. */
export function SecretOnce({ label, value, children, onDismiss }: { label: string; value: string; children?: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="t-enter space-y-2.5 rounded-[14px] border border-floor/30 bg-floor/[0.06] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            I've stored it
          </Button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-1.5 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px]">{value}</code>
        <CopyButton text={value} />
      </div>
      {children && <div className="text-[12.5px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A dollar amount input with a leading "$". */
export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <input type="number" min="0" step="0.01" inputMode="decimal" {...props} className={cx(inputCls, "pl-6 tabular", props.className)} />
    </div>
  );
}

/** Thin progress bar: accent fill on a muted track. */
export function Meter({ value, tone = "accent", label }: { value: number; tone?: "accent" | "warn" | "danger"; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cx("h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)]", tone === "accent" && "bg-accent", tone === "warn" && "bg-queued", tone === "danger" && "bg-destructive")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tag input: comma or Enter adds, backspace on empty removes the last. */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  prefix = "",
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  prefix?: string;
}) {
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
    <div className={cx(inputCls, "flex min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15")}>
      {values.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-[12.5px] text-foreground">
          {prefix}
          {t}
          <button type="button" aria-label={`Remove ${prefix}${t}`} className="press flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-border-strong hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-[110px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint"
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
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit(draft)}
      />
    </div>
  );
}

/** Inline status line after a save: green for done, red for errors. */
export function SaveNote({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) return <p role="alert" className="text-[13px] text-destructive">{error}</p>;
  if (ok) return <p role="status" className="t-enter text-[13px] text-floor">{ok}</p>;
  return null;
}

/** Re-run the server fetch on an interval while the tab is visible (live lists). */
export function useAutoRefresh(ms: number) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [ms, router]);
}

/** Generic proxy mutation: fetch /api/proxy{path}, throw a readable error, parse JSON. */
export async function proxyFetch<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ");
    } catch {
      /* not JSON */
    }
    throw new Error(msg.slice(0, 200) || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : undefined) as T;
}

"use client";

/**
 * Marketer's primitives (ported from Podium's ui.tsx; see web/DESIGN.md).
 * Reuse these; never restyle by hand. If a primitive can't do what you need,
 * extend it here so every use gets it.
 */
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
} from "react";
import { EmptyArt, type EmptyArtKind } from "./empty-art";
import { fieldGradient, paletteFor, type Palette } from "./shader";

export function cx(...xs: (string | false | null | undefined | 0)[]) {
  return xs.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ buttons */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "accent";
type Size = "sm" | "md" | "lg" | "icon";

export function buttonCls(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cx(
    "press inline-flex shrink-0 touch-manipulation select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-45 [-webkit-tap-highlight-color:transparent] [&_svg]:size-4",
    size === "sm" && "h-8 px-3 text-[13px]",
    size === "md" && "h-9 px-4 text-sm",
    size === "lg" && "h-11 px-6 text-[15px]",
    size === "icon" && "size-9",
    variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
    variant === "accent" && "bg-accent text-accent-foreground hover:brightness-110",
    variant === "secondary" && "border border-border bg-card text-foreground shadow-pill hover:bg-muted/60 dark:border-transparent dark:bg-muted dark:hover:bg-border-strong",
    variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
    variant === "danger" && "bg-destructive text-white hover:brightness-110",
    variant === "success" && "bg-floor text-white hover:brightness-110",
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonCls(variant, size, className)}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
}

/** A Button that navigates. Same look, real link. */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; size?: Size }) {
  return (
    <Link href={href} {...rest} className={buttonCls(variant, size, className)}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------- inputs */

export const inputCls =
  "w-full rounded-[14px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-border-strong focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function FieldGroup({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, "resize-y", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, "pr-8", p.className)} />;

/** A pill toggle (aria-pressed), for choosing platforms, departments, filters. */
export function Chip({ selected, onClick, children, className }: { selected?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] [&_svg]:size-3.5",
        selected ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("press relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150", checked ? "bg-accent" : "bg-border-strong")}
    >
      <span className={cx("absolute top-[2px] size-[18px] rounded-full bg-white shadow-pill transition-transform duration-200 ease-[var(--ease-out)]", checked ? "translate-x-[18px]" : "translate-x-[2px]")} />
    </button>
  );
}

/* -------------------------------------------------------------------- modal */

export function Modal({ open, onClose, title, children, wide, bare }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; bare?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={(e) => e.target === e.currentTarget && onClose()}
      aria-label={title}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("t-modal mk-app m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-[20px] bg-card p-0 text-foreground shadow-modal", wide ? "max-w-2xl" : "max-w-lg")}
    >
      {open &&
        (bare ? (
          children
        ) : (
          <div className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
              <Button variant="ghost" size="icon" className="-mr-2 size-8" onClick={onClose} aria-label="Close" title="Close">
                <X />
              </Button>
            </div>
            {children}
          </div>
        ))}
    </dialog>
  );
}

/* ------------------------------------------------------ tiles, badges, dots */

/** The one icon tile: 8px corners, muted fill; `live` only for something happening now. */
export function IconTile({ children, size = 32, tone = "muted", className }: { children: ReactNode; size?: number; tone?: "muted" | "live"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("flex shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", tone === "live" ? "bg-floor/12 text-floor" : "bg-muted text-muted-foreground", size >= 44 && "[&_svg]:size-5", className)}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

export type Tone = "muted" | "live" | "warn" | "accent" | "danger";

export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium [&_svg]:size-3",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "live" && "bg-floor/12 text-floor",
        tone === "warn" && "bg-queued/12 text-queued",
        tone === "accent" && "bg-accent/10 text-accent",
        tone === "danger" && "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Dots, not badges: blue for new, orange for needs-you, pulsing green for live. */
export function Dot({ tone = "accent", label }: { tone?: "accent" | "warn" | "live" | "danger" | "muted"; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      className={cx(
        "inline-block size-[7px] shrink-0 rounded-full",
        tone === "accent" && "bg-accent",
        tone === "warn" && "bg-queued",
        tone === "live" && "live-dot bg-floor",
        tone === "danger" && "bg-destructive",
        tone === "muted" && "bg-faint",
      )}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-muted px-1 font-mono text-[11px] text-muted-foreground">{children}</kbd>;
}

/** The eight-point asterisk that marks agents, so they're never told apart by colour alone. */
export function AgentMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className={className} style={style} aria-hidden>
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

/**
 * An agent's avatar: a circle on its colour field with the asterisk badge.
 * Every department owns one palette, the same everywhere.
 */
export function AgentAvatar({ name, palette, size = 28, working }: { name: string; palette?: Palette; size?: number; working?: boolean }) {
  const p = palette ?? paletteFor(name);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={name}>
      <span
        aria-hidden
        className={cx("flex size-full items-center justify-center rounded-full font-medium", working && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
        style={{ background: fieldGradient(p), color: "rgb(0 0 0 / 0.72)", fontSize: size * 0.4, boxShadow: "inset 0 0 0 0.5px rgb(0 0 0 / 0.1)" }}
      >
        {name.replace(/[^\p{L}]/gu, "").slice(0, 1).toUpperCase()}
      </span>
      {size >= 20 && (
        <span className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-background p-[2px]">
          <AgentMark style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }} className="text-foreground/70" />
        </span>
      )}
    </span>
  );
}

/** People get a soft pastel from their name. */
export function PersonAvatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(160deg, hsl(${h} 78% 88%), hsl(${h} 62% 75%))`, color: `hsl(${h} 45% 24%)`, boxShadow: "inset 0 0 0 0.5px rgb(0 0 0 / 0.1)" }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* -------------------------------------------------------- empty and errors */

export function Empty({ art, icon, title, children, action }: { art?: EmptyArtKind; icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="t-enter mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-12 text-center">
      {art ? <EmptyArt kind={art} size={132} className="-mb-1" /> : icon && <IconTile size={44} className="mb-1">{icon}</IconTile>}
      <div className="font-medium">{title}</div>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/* ---------------------------------------------------------- segmented, check */

/** Segmented control with a sliding pill. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className={cx("relative grid h-[26px] rounded-lg bg-muted p-[2px]", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute inset-y-[2px] left-[2px] rounded-[6px] bg-seg-pill shadow-pill transition-transform duration-[250ms] ease-[var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("relative z-10 h-[22px] rounded-[6px] px-2 text-[13px] font-medium transition-colors duration-150", o.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Filled blue check (done) or dashed circle (to do). */
export function CheckCircle({ done = true, className }: { done?: boolean; className?: string }) {
  return done ? (
    <svg viewBox="0 0 22 22" className={cx("t-check size-[20px] shrink-0 drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.12)]", className)} aria-hidden>
      <circle cx="11" cy="11" r="10.5" fill="white" />
      <circle cx="11" cy="11" r="8.6" fill="hsl(var(--accent))" />
      <path d="M7.2 11.3l2.5 2.4 5-5.2" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className={cx("size-[18px] shrink-0 text-faint", className)} aria-hidden>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.6" />
    </svg>
  );
}

/** Progress ring (Getting started). */
export function Ring({ value, size = 16 }: { value: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} className="transition-[stroke-dashoffset] duration-500 ease-[var(--ease-out)]" />
    </svg>
  );
}

/** Tiny bar sparkline for KPI tiles (the reference's mini bars). */
export function Sparkbars({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const shown = values.slice(-14);
  return (
    <span aria-hidden className={cx("flex h-6 items-end gap-[3px]", className)}>
      {shown.map((v, i) => (
        <span key={i} className={cx("w-[5px] rounded-[2px]", i === shown.length - 1 ? "bg-foreground/70" : "bg-muted-foreground/25")} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

/** Signed % change between two numbers, coloured only by meaning. */
export function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (!before && !now) return null;
  const pct = before ? ((now - before) / before) * 100 : 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return <span className="text-[12px] text-faint tabular">0%</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={cx("text-[12px] font-medium tabular", good ? "text-floor" : "text-destructive")}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

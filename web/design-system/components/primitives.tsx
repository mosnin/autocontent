"use client";

/**
 * Primitives. Each maps to a reference screen (see ../README.md). Reuse them;
 * never restyle by hand. If one can't do what you need, extend it here.
 */
import { Check, ChevronDown, ChevronsUpDown, Loader2, X } from "lucide-react";
import Link from "next/link";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";

/* ------------------------------------------------------------------ Button */
/* Ref 05 "Accounts / Refresh / Save as report", ref 02 "Dismiss / Edit / Approve & Run".
   Rounded rectangles (6px), 28px tall by default. Primary is the white button. */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "ds-press inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
    size === "xl" ? "rounded-ds-md" : "rounded-ds-sm",
    size === "sm" && "h-6 px-2 text-[12px] [&_svg]:size-3.5",
    size === "md" && "h-7 px-2.5 text-[13px] [&_svg]:size-3.5",
    size === "lg" && "h-9 px-4 text-[14px] [&_svg]:size-4",
    // The StepFlow action: as tall as the step's field, same corners.
    size === "xl" && "h-11 px-5 text-[15px] [&_svg]:size-4",
    variant === "primary" && "bg-ds-primary text-ds-primary-fg hover:opacity-90",
    variant === "secondary" && "border border-hairline bg-surface-2 text-fg hover:border-hairline-strong hover:bg-surface-3",
    variant === "ghost" && "text-fg-muted hover:bg-surface-2 hover:text-fg",
    variant === "danger" && "bg-negative text-ds-primary-fg hover:opacity-90",
    variant === "accent" && "bg-ds-accent text-ds-primary-fg hover:opacity-90",
    className,
  );
}

export function Button({ variant, size, loading, className, children, ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="ds-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant, size, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link href={href} {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** Square icon-only button (sidebar search/collapse, header panel toggles). Always labelled. */
export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx("ds-press flex size-7 shrink-0 items-center justify-center rounded-ds-sm text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-[15px]", active && "bg-surface-3 text-fg", className)}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- Badges */

/** Small red count (ref 02: "Activity 3"). Numbers only. */
export function CountBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-ds-xs bg-count px-1 text-[10.5px] font-semibold leading-none text-ds-primary-fg tabular">{count > 99 ? "99+" : count}</span>;
}

/** Blue "New" tag (ref 05: "MCP New"). */
export function NewBadge({ children = "New" }: { children?: ReactNode }) {
  return <span className="inline-flex h-[18px] items-center rounded-ds-xs bg-ds-accent/20 px-1.5 text-[11px] font-medium text-ds-accent">{children}</span>;
}

export type StatusTone = "neutral" | "positive" | "negative" | "attention" | "accent";

/** A word of status on a row ("Live", "Failed", "Draft"). Text, tinted fill, no dot. */
export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-ds-xs px-1.5 text-[11.5px] font-medium",
        tone === "neutral" && "bg-surface-3 text-fg-muted",
        tone === "positive" && "bg-positive/15 text-positive",
        tone === "negative" && "bg-negative/15 text-negative",
        tone === "attention" && "bg-attention/15 text-attention",
        tone === "accent" && "bg-ds-accent/15 text-ds-accent",
      )}
    >
      {children}
    </span>
  );
}

/** Signed change in a KPI ("+47%" green, "−23%" red). */
export function Delta({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.5;
  return <span className={cx("text-[12px] font-medium tabular", flat ? "text-fg-faint" : good ? "text-positive" : "text-negative")}>{flat ? "0%" : `${value > 0 ? "+" : "−"}${Math.abs(Math.round(value))}%`}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-ds-xs border border-hairline px-1 font-mono text-[10.5px] text-fg-faint">{children}</kbd>;
}

/** Number badge for option rows (ref 06: "1 Answer #1"). */
export function NumberKey({ n }: { n: number | string }) {
  return <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-ds-xs border border-hairline bg-surface-2 text-[12px] text-fg-muted tabular">{n}</span>;
}

/* ------------------------------------------------------------ Icons & avatars */

export type ToolTone = "a" | "b" | "c" | "d" | "e" | "f";

/** Coloured tool icon (ref 02/05 "Tools": Campaign, Creatives, Briefs, Workflows). */
export function ToolIcon({ tone, children, size = 16 }: { tone: ToolTone; children: ReactNode; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-ds-xs text-on-fill [&_svg]:stroke-[2.25]"
      style={{ width: size, height: size, background: `var(--ds-tool-${tone})` }}
    >
      <span className="flex [&_svg]:size-[65%]" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        {children}
      </span>
    </span>
  );
}

/** Neutral icon tile for list rows and cards (ref 07 "Pipeline review" icon). */
export function IconTile({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-ds-md border border-hairline bg-surface-2 text-fg-muted [&_svg]:size-[15px]" style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

/** Agent glyph (ref 02 "Orchestrator"): a soft monochrome orb with an asterisk. */
export function AgentGlyph({ size = 20, tone }: { size?: number; tone?: ToolTone }) {
  return (
    <span aria-hidden className="relative inline-flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: tone ? `var(--ds-tool-${tone})` : "radial-gradient(circle at 35% 30%, hsl(0 0% 85%), hsl(0 0% 45%) 60%, hsl(0 0% 25%))" }}>
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="white" strokeWidth={2.6} strokeLinecap="round">
        <path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7" />
      </svg>
    </span>
  );
}

export function PersonAvatar({ name, size = 24 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-medium" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 45% 70%)`, color: `hsl(${h} 50% 18%)` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Workspace logo square (ref 05 "Ace Studio", ref 07 "Granola"). */
export function WorkspaceLogo({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-ds-xs font-semibold text-on-fill-ink" style={{ width: size, height: size, fontSize: size * 0.55, background: "var(--ds-tool-e)" }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Progress arc (ref 05 "Getting started 1 of 5", ref 07 "Get started"). Static unless `spinning`. */
export function ProgressRing({ value, size = 14, spinning }: { value: number; size?: number; spinning?: boolean }) {
  const r = (size - 2.5) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cx("shrink-0 -rotate-90", spinning && "ds-spin")} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--ds-border-strong))" strokeWidth="1.75" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--ds-accent))" strokeWidth="1.75" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.08, Math.min(1, value)))} />
    </svg>
  );
}

/** Hollow step circle / filled check (ref 02 plan steps, trace nodes). */
export function StepMark({ state }: { state: "todo" | "active" | "done" | "failed" }) {
  if (state === "done")
    return (
      <span aria-hidden className="flex size-[14px] shrink-0 items-center justify-center rounded-full bg-positive text-ds-primary-fg">
        <Check className="size-[9px]" strokeWidth={3.5} />
      </span>
    );
  if (state === "failed")
    return (
      <span aria-hidden className="flex size-[14px] shrink-0 items-center justify-center rounded-full bg-negative text-ds-primary-fg">
        <X className="size-[9px]" strokeWidth={3.5} />
      </span>
    );
  return <span aria-hidden className={cx("block size-[14px] shrink-0 rounded-full border-[1.5px]", state === "active" ? "ds-spin border-fg-muted border-t-transparent" : "border-hairline-strong")} />;
}

/** Small round bullet for list items (ref 05 "Awaiting action", ref 01 "Recent sessions"). Static, never animated. */
export function Bullet({ tone = "neutral" }: { tone?: "neutral" | "attention" | "accent" | "positive" | "negative" }) {
  return <span aria-hidden className={cx("inline-block size-[5px] shrink-0 rounded-full", tone === "neutral" && "bg-fg-faint", tone === "attention" && "bg-attention", tone === "accent" && "bg-ds-accent", tone === "positive" && "bg-positive", tone === "negative" && "bg-negative")} />;
}

/* ------------------------------------------------------------ Segmented */
/* Ref 02/07: Home | Activity, Installed | Discover. Track surface-2, pill surface-3. */

export function Segmented<T extends string>({ value, onChange, options, label, size = "md", className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: "sm" | "md"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The selected pill is one element that slides to the chosen option (measured after mount).
  // Until it's measured (server render, first paint) the selected button draws its own pill.
  const [thumb, setThumb] = useState<{ x: number; w: number; animate: boolean } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (animate: boolean) => {
      const btn = el.querySelectorAll<HTMLElement>('[role="tab"]')[index];
      if (!btn) return setThumb(null);
      setThumb((prev) => ({ x: btn.offsetLeft, w: btn.offsetWidth, animate: animate && prev !== null }));
    };
    place(true);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);
  // Tabs pattern: one tab stop, arrows move and select, Home/End jump.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = index;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % options.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + options.length) % options.length : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (next < 0 || next === i) return;
    e.preventDefault();
    onChange(options[next]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  const pill = "bg-surface-3 shadow-[inset_0_0_0_1px_hsl(var(--ds-border))]";
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx("relative inline-flex rounded-ds-md bg-surface-2 p-[3px]", className)}>
      {thumb && (
        <span
          aria-hidden
          className={cx("pointer-events-none absolute bottom-[3px] left-0 top-[3px] rounded-ds-sm", pill, thumb.animate && "ds-seg-thumb")}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx(
            "ds-press relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-ds-sm px-3 font-medium",
            size === "sm" ? "h-6 text-[12.5px]" : "h-7 text-[13px]",
            o.value === value ? cx("text-fg", !thumb && pill) : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Filter pill */
/* Ref 05 toolbar: "Last 30 days ⇕", "Compare ⇕", "USD ⇕", "All channels ⇕". */

export function FilterPill<T extends string>({ icon, value, options, onChange, label }: { icon?: ReactNode; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  useOutside(ref, open, () => close(ref.current?.contains(document.activeElement) ?? false));
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `${label}: ${current.label}` : label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) (e.preventDefault(), setOpen(true));
        }}
        className="ds-press flex h-7 items-center gap-1.5 rounded-ds-sm border border-hairline bg-surface px-2.5 text-[12.5px] text-fg hover:border-hairline-strong [&_svg]:size-3.5 [&_svg]:text-fg-muted"
      >
        {icon}
        {current?.label ?? label}
        <ChevronsUpDown className="!size-3 !text-fg-faint" />
      </button>
      {open && (
        <Menu label={label} onClose={() => close(false)} className="left-0 top-full mt-1 min-w-[180px]">
          {options.map((o) => (
            <MenuItem key={o.value} selected={o.value === value} onClick={() => (onChange(o.value), close())}>
              {o.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Menu */

const MENU_ITEM = '[role="option"]:not(:disabled)';

/**
 * A popover list. Keyboard: focus lands on the selected (or first) item when
 * it opens, ↑/↓ move, Home/End jump, a letter jumps to the next match, Tab
 * closes it. Escape is handled by the trigger (`useOutside`), which also
 * takes focus back.
 */
export function Menu({ children, className, label, onClose }: { children: ReactNode; className?: string; label?: string; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    (el.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? el.querySelector<HTMLElement>(MENU_ITEM))?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Tab") return onClose?.();
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const from = i + 1;
      for (let n = 0; n < items.length; n++) {
        const j = (from + n) % items.length;
        if ((items[j]!.textContent ?? "").trim().toLowerCase().startsWith(k)) {
          next = j;
          break;
        }
      }
      if (next < 0) return;
    }
    if (next < 0) return;
    e.preventDefault();
    items[next]!.focus();
  };
  return (
    <div ref={ref} role="listbox" aria-label={label} onKeyDown={onKeyDown} className={cx("ds-pop absolute z-50 rounded-ds-md border border-hairline bg-overlay p-1 shadow-ds-float", className)}>
      {children}
    </div>
  );
}

export function MenuItem({ children, selected, onClick, icon, hint, disabled }: { children: ReactNode; selected?: boolean; onClick?: () => void; icon?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-ds-sm px-2 text-left text-[13px] text-fg hover:bg-surface-2 focus-visible:bg-surface-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[15px] [&_svg]:text-fg-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[12px] text-fg-muted">{hint}</span>}
      {selected && <Check className="!text-ds-accent" />}
    </button>
  );
}

/** A select-style trigger that opens a Menu (model picker "Sonnet 5 ⌄", workspace switcher). */
export function MenuButton({ trigger, children, align = "left", up, label }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; up?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const refocus = () => slot.current?.querySelector<HTMLElement>("button, [href], [tabindex]")?.focus();
  const close = () => {
    setOpen(false);
    refocus();
  };
  useOutside(ref, open, () => {
    const inside = ref.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (inside) refocus();
  });
  return (
    <div ref={ref} className="relative">
      <div
        ref={slot}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) (e.preventDefault(), setOpen(true));
        }}
      >
        {trigger(open)}
      </div>
      {open && (
        <Menu label={label} onClose={() => setOpen(false)} className={cx("min-w-[220px]", align === "left" ? "left-0" : "right-0", up ? "bottom-full mb-1" : "top-full mt-1")}>
          {children(close)}
        </Menu>
      )}
    </div>
  );
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOutside();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, active, onOutside]);
}

/* ------------------------------------------------------------ Form controls */

export const inputClass =
  "w-full rounded-ds-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fg-faint hover:border-hairline-strong focus:border-ds-accent focus:ring-2 focus:ring-ds-accent/20 disabled:opacity-50";

/** `inputSize="lg"` is the one-question-at-a-time field (StepFlow): 44px, 15px text. */
export const Input = ({ inputSize, ...p }: InputHTMLAttributes<HTMLInputElement> & { inputSize?: "md" | "lg" }) => (
  <input {...p} className={cx(inputClass, inputSize === "lg" ? "h-11 px-3.5 text-[15px]" : "h-8", p.className)} />
);
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputClass, "resize-y", p.className)} />;
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...p} className={cx(inputClass, "h-8 appearance-none pr-8", className)} />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-fg-muted">{hint}</span>}
    </label>
  );
}

/** A labelled group for controls that aren't one input (chips, tag inputs, a time list). `Field` is a <label>, so groups need their own wrapper. */
export function FieldGroup({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <span className="block text-[12.5px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-fg-muted">{hint}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-150 disabled:opacity-45", checked ? "bg-ds-accent" : "bg-fg-faint")}
    >
      <span className={cx("absolute left-0 top-[2px] size-[14px] rounded-full bg-ds-primary-fg transition-transform duration-200 ease-[var(--ds-ease-out)]", checked ? "translate-x-[14px]" : "translate-x-[2px]")} style={{ background: "white" }} />
    </button>
  );
}

/** A switch with its label and one line of detail in a bordered row. With `name`, it posts "on" when checked. */
export function SwitchRow({ name, label, detail, checked, onChange, disabled }: { name?: string; label: string; detail?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-ds-md border border-hairline bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {detail && <div className="text-[12px] text-fg-muted">{detail}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      {name && checked && <input type="hidden" name={name} value="on" />}
    </div>
  );
}

/* ------------------------------------------------------------ Modal */
/* Native <dialog>.showModal(): the page behind is inert, so Tab stays inside
   (the focus trap), and Escape asks to close. We put focus on the first
   control when it opens and hand it back to whatever had it when it closes. */

export function Modal({ open, onClose, title, children, footer, width = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: "sm" | "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const isOpen = useRef(open);
  isOpen.current = open;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      // Prefer the first field or action in the body over the Close button.
      (d.querySelector<HTMLElement>("[autofocus]") ?? d.querySelector<HTMLElement>("[data-modal-body] :is(input, textarea, select, button, a[href]):not(:disabled)") ?? d.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    }
    if (!open && d.open) d.close();
    if (!open && opener.current) {
      const el = opener.current;
      opener.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open]);
  // Closed by unmounting (a parent that renders the modal conditionally): still hand focus back.
  useEffect(
    () => () => {
      const el = opener.current;
      if (el?.isConnected) el.focus();
    },
    [],
  );
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape: the owner decides (a busy confirm stays open), so the element and `open` never disagree.
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClose={(e) => e.target === e.currentTarget && isOpen.current && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("ds-modal m-auto max-h-[88vh] w-[calc(100%-2rem)] overflow-hidden rounded-ds-xl border border-hairline bg-overlay p-0 text-fg shadow-ds-modal", width === "sm" && "max-w-sm", width === "md" && "max-w-lg", width === "lg" && "max-w-2xl")}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-hairline px-4">
            <h2 id={titleId} className="text-[14px] font-medium">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </div>
          <div data-modal-body className="min-h-0 flex-1 overflow-y-auto p-4">
            {children}
          </div>
          {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

"use client";

/**
 * StepFlow: one field or one question per screen (see ../FLOW.md).
 *
 * Sign-up, sign-in, recovery, onboarding and the code flow on the plan screen
 * all use it, so moving through any of them feels the same:
 *
 * - `useStepFlow(order)` owns which step is showing, the direction of travel,
 *   and browser back (each step is a history entry, so Back works).
 * - `<StepFlow>` slides the new step in from the side it came from while the
 *   old one leaves the other way, glides the height between them (no layout
 *   jump), and moves focus to the new step's field. Reduced motion: a plain
 *   crossfade, no travel, no blur.
 * - `<Step>` is the screen: a title, one line, the control, one primary
 *   action. It is a form, so Enter advances.
 * - `<StepProgress>` is the quiet progress mark; `<StepBack>` the back button.
 * - `<CodeInput>` is the six-digit code field (paste and one-time-code
 *   autofill friendly), `<OptionList>` the numbered single-choice list.
 */
import { ArrowLeft, Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { Button, NumberKey } from "./primitives";

/* ------------------------------------------------------------------ state */

export interface StepFlowState<T extends string> {
  step: T;
  /** 1 when moving forward through `order`, -1 when going back. */
  direction: 1 | -1;
  index: number;
  count: number;
  /**
   * Show `next`. `replace` swaps the current step for it in history. `lock`
   * makes it the floor: nothing before it can be returned to (an account was
   * just created, a code was just redeemed).
   */
  go: (next: T, opts?: { replace?: boolean; lock?: boolean }) => void;
  /** One step back (browser history when `history` is on). */
  back: () => void;
  canBack: boolean;
}

const HISTORY_KEY = "__dsStep";

/**
 * The step a flow is on. `order` is the full sequence, used for direction and
 * progress; a flow may skip steps. With `history` (the default) each step is a
 * browser history entry on the same URL, so the browser's Back button steps
 * back too, and a step can never be reached by Back unless it was visited.
 */
export function useStepFlow<T extends string>(order: readonly T[], opts: { initial?: T; history?: boolean } = {}): StepFlowState<T> {
  const initial = opts.initial ?? order[0]!;
  const useHistory = opts.history ?? true;
  const [state, setState] = useState<{ step: T; direction: 1 | -1 }>({ step: initial, direction: 1 });
  const trail = useRef<T[]>([initial]);
  const floor = useRef(0);
  const flowId = useId();

  const indexOf = useCallback((s: T) => Math.max(0, order.indexOf(s)), [order]);

  // Steps after the first are history entries this flow pushes, marked with
  // its id. The entry the page loaded on is left exactly as Next wrote it
  // (rewriting it can make the router re-request the page): coming back to an
  // entry without our mark means the first step.
  useEffect(() => {
    if (!useHistory || typeof window === "undefined") return;
    const onPop = (e: PopStateEvent) => {
      const mark = (e.state as Record<string, unknown> | null)?.[HISTORY_KEY] as { id?: string; step?: T; depth?: number } | undefined;
      if (mark && mark.id !== flowId) return;
      if (!mark && trail.current.length < 2) return;
      const depth = mark?.depth ?? 0;
      if (depth < floor.current) return;
      const target = trail.current[depth] ?? mark?.step ?? initial;
      trail.current = trail.current.slice(0, depth + 1);
      setState((cur) => ({ step: target, direction: indexOf(target) >= indexOf(cur.step) ? 1 : -1 }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // Runs once per flow instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback(
    (next: T, o?: { replace?: boolean; lock?: boolean }) => {
      setState((cur) => ({ step: next, direction: indexOf(next) >= indexOf(cur.step) ? 1 : -1 }));
      if (o?.replace) trail.current[trail.current.length - 1] = next;
      else trail.current.push(next);
      if (o?.lock) floor.current = trail.current.length - 1;
      // The page's own entry (depth 0) is never rewritten; see above.
      if (!useHistory || (o?.replace && trail.current.length === 1)) return;
      const mark = { id: flowId, step: next, depth: trail.current.length - 1 };
      const data = { ...(window.history.state ?? {}), [HISTORY_KEY]: mark };
      if (o?.replace) window.history.replaceState(data, "");
      else window.history.pushState(data, "");
    },
    [flowId, indexOf, useHistory],
  );

  const back = useCallback(() => {
    if (trail.current.length - 1 <= floor.current) return;
    if (useHistory) {
      window.history.back();
      return;
    }
    trail.current.pop();
    const prev = trail.current[trail.current.length - 1]!;
    setState({ step: prev, direction: -1 });
  }, [useHistory]);

  return { step: state.step, direction: state.direction, index: indexOf(state.step), count: order.length, go, back, canBack: trail.current.length - 1 > floor.current };
}

/* ------------------------------------------------------------------ motion */

const EASE_OUT = [0.22, 1, 0.36, 1] as const; // --ds-ease-out
const TRAVEL = 28;

/**
 * Shows one step at a time. Pass the current step's element as `children` and
 * its id as `step`. The container's height follows the step with the same
 * easing, so whatever sits below never jumps.
 */
export function StepFlow({ step, direction, children, className }: { step: string; direction: 1 | -1; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // The old step leaves quickly and the new one arrives just behind it, so the
  // two never read as overlapping text. Exit is faster than enter.
  const variants = {
    enter: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * TRAVEL, filter: "blur(6px)" }),
    center: {
      opacity: 1,
      x: 0,
      filter: "blur(0px)",
      transition: reduce
        ? { opacity: { duration: 0.2, ease: EASE_OUT } }
        : { opacity: { duration: 0.32, delay: 0.06, ease: EASE_OUT }, x: { duration: 0.46, ease: EASE_OUT }, filter: { duration: 0.36, delay: 0.04, ease: EASE_OUT } },
    },
    exit: (d: number) =>
      reduce
        ? { opacity: 0, transition: { duration: 0.15 } }
        : { opacity: 0, x: d * -TRAVEL * 0.5, filter: "blur(2px)", transition: { duration: 0.16, ease: EASE_OUT } },
  };

  return (
    <motion.div
      className={cx("relative", className)}
      animate={{ height }}
      initial={false}
      transition={{ duration: reduce ? 0 : 0.42, ease: EASE_OUT }}
    >
      <div ref={inner}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full"
          >
            <FocusOnMount>{children}</FocusOnMount>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Moves focus into a step when it appears: `[data-autofocus]`, else the first field, else the selected option. */
function FocusOnMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      const target =
        el.querySelector<HTMLElement>("[data-autofocus]") ??
        el.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), textarea:not(:disabled)") ??
        el.querySelector<HTMLElement>('[role=radio][aria-checked="true"]') ??
        el.querySelector<HTMLElement>("h1, h2");
      if (target && !target.hasAttribute("tabindex") && /^H[12]$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return <div ref={ref}>{children}</div>;
}

/* ------------------------------------------------------------------ the screen */

export interface StepAction {
  label: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Without `onClick`, the primary submits the step (Enter does the same). */
  onClick?: () => void;
}

/**
 * One screen of a flow: title, one line, the control, one primary action and
 * at most a quiet secondary row. It is a form: Enter submits it.
 */
export function Step({
  title,
  subtitle,
  children,
  onSubmit,
  primary,
  secondary,
  eyebrow,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  onSubmit?: () => void;
  primary?: StepAction;
  /** Quiet links or ghost buttons under the primary action. */
  secondary?: ReactNode;
  /** A small line above the title (the person's email, the workspace). */
  eyebrow?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (primary?.loading || primary?.disabled) return;
    onSubmit?.();
  };
  return (
    <form noValidate onSubmit={submit} aria-labelledby={titleId} className={cx("ds-stagger flex flex-col", className)}>
      {eyebrow && <div className="mb-3 text-[13px] text-fg-muted">{eyebrow}</div>}
      <h1 id={titleId} className="text-[26px] font-medium leading-[1.15] tracking-[-0.022em] outline-none">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{subtitle}</p>}
      {children && <div className="mt-7">{children}</div>}
      {primary && (
        <div className="mt-5">
          <Button type={primary.onClick ? "button" : "submit"} onClick={primary.onClick} variant="primary" size="xl" className="w-full" loading={primary.loading} disabled={primary.disabled}>
            {primary.label}
          </Button>
        </div>
      )}
      {secondary && <div className="mt-4 flex flex-col items-center gap-1 text-[13.5px]">{secondary}</div>}
    </form>
  );
}

/** A quiet text action under a step's primary button. */
export function StepLink({ children, onClick, href, disabled }: { children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = "ds-press rounded-ds-sm px-2 py-1 text-fg-muted underline-offset-4 hover:text-fg hover:underline disabled:pointer-events-none disabled:opacity-45";
  if (href)
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/** The back control above a step. Renders nothing (but keeps its space) when there's nowhere to go. */
export function StepBack({ flow, label = "Back" }: { flow: Pick<StepFlowState<string>, "back" | "canBack">; label?: string }) {
  return (
    <button
      type="button"
      onClick={flow.back}
      aria-label={label}
      aria-hidden={!flow.canBack || undefined}
      tabIndex={flow.canBack ? 0 : -1}
      className={cx(
        "ds-press -ml-2 inline-flex size-8 items-center justify-center rounded-full text-fg-muted transition-opacity duration-200 hover:bg-surface-2 hover:text-fg",
        flow.canBack ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}

/** Quiet progress: a short mark per step, the current one longer. Never "Step 2 of 5" on screen. */
export function StepProgress({ index, count, className }: { index: number; count: number; className?: string }) {
  if (count < 2) return null;
  return (
    <div className={cx("flex items-center gap-1", className)} role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1} aria-label="Progress">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx("h-1 rounded-full transition-[width,background-color] duration-[420ms] ease-[var(--ds-ease-out)]", i === index ? "w-5 bg-fg" : i < index ? "w-2 bg-fg-faint" : "w-2 bg-hairline-strong")}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ code input */

/**
 * A six-digit (or `length`) code. One real input under the boxes, so paste,
 * one-time-code autofill and screen readers all see a single field. Calls
 * `onComplete` once every digit is in.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  invalid,
  disabled,
  name = "code",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  name?: string;
}) {
  const [focused, setFocused] = useState(false);
  const id = useId();
  const digits = value.split("");
  const set = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, length);
    onChange(v);
    if (v.length === length && v !== value) onComplete?.(v);
  };
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div aria-hidden className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, i) => {
          const active = focused && (i === digits.length || (i === length - 1 && digits.length === length));
          return (
            <div
              key={i}
              className={cx(
                "flex h-14 items-center justify-center rounded-ds-md border bg-surface-2 text-[22px] font-medium tabular transition-[border-color,box-shadow] duration-150",
                invalid ? "border-negative/60" : active ? "border-ds-accent ring-2 ring-ds-accent/20" : "border-hairline",
              )}
            >
              {digits[i] ? <span className="ds-digit">{digits[i]}</span> : active ? <span className="ds-caret h-6 w-px bg-fg" /> : null}
            </div>
          );
        })}
      </div>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => set(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        data-autofocus
        className="absolute inset-0 size-full cursor-text rounded-ds-md opacity-0"
        // The real input is invisible: the boxes draw its focus state.
        style={{ caretColor: "transparent", letterSpacing: "2em" }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ option list */

/**
 * Numbered single choice (ref 06): ↑/↓ move and select, number keys pick
 * (when the person isn't typing), Enter submits the step around it.
 */
export function OptionList<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; detail?: ReactNode; icon?: ReactNode }[];
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        onChange(options[n - 1]!.id);
        refs.current[n - 1]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    // Enter on a chosen row continues, like Enter in a field: it submits the step around it.
    if (e.key === "Enter") {
      e.preventDefault();
      onChange(options[i]!.id);
      e.currentTarget.form?.requestSubmit();
      return;
    }
    const next = e.key === "ArrowDown" ? (i + 1) % options.length : e.key === "ArrowUp" ? (i - 1 + options.length) % options.length : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="space-y-1.5">
      {options.map((o, i) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "ds-press flex min-h-12 w-full items-center gap-3 rounded-ds-md border px-3 py-2.5 text-left focus-visible:outline-offset-2 transition-[border-color,background-color,box-shadow] duration-200",
              selected ? "border-ds-accent bg-surface-3 ring-1 ring-ds-accent" : "border-hairline bg-surface-2 hover:border-hairline-strong",
            )}
          >
            <NumberKey n={i + 1} />
            {o.icon && <span className="flex text-fg-muted [&_svg]:size-4">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium">{o.label}</span>
              {o.detail && <span className="mt-0.5 block text-[12.5px] text-fg-muted">{o.detail}</span>}
            </span>
            <span aria-hidden className={cx("flex size-5 items-center justify-center rounded-full transition-opacity duration-200", selected ? "bg-ds-accent text-ds-primary-fg opacity-100" : "opacity-0")}>
              <Check className="size-3" strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

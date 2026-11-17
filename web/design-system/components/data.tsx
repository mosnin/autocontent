"use client";

/**
 * Data display, from ref 05 (analytics) and ref 01 (home bento).
 * One accent line for the current period, a muted line for the comparison,
 * hairline gridlines, tabular numbers. No chart libraries.
 */
import { Globe } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { cx } from "../cx";
import { Delta } from "./primitives";

/** Card label row: small icon + muted label with a dotted underline (ref 05 "⊕ Gross Sales"). */
export function DataLabel({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-fg-muted [&_svg]:size-3 [&_svg]:shrink-0">
      {icon ?? <Globe />}
      <span className="truncate underline decoration-hairline-strong decoration-dotted underline-offset-[3px]">{children}</span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/** Grey mini bars, last one emphasised (ref 05 KPI cards). */
export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  const shown = values.slice(-12);
  const max = Math.max(1, ...shown);
  return (
    <span aria-hidden className={cx("flex h-[22px] items-end gap-[2px]", className)}>
      {shown.map((v, i) => (
        <span key={i} className="w-[5px] rounded-ds-2xs bg-fg-faint/40" style={{ height: `${Math.max(14, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

/** KPI card (ref 05): label, 20px value, delta, mini bars on the right. */
export function KpiCard({ label, value, delta, invert, bars, href, icon }: { label: string; value: ReactNode; delta?: number | null; invert?: boolean; bars?: number[]; href?: string; icon?: ReactNode }) {
  const body = (
    <>
      <DataLabel icon={icon}>{label}</DataLabel>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-medium leading-none tracking-[-0.01em] tabular">{value}</span>
          <Delta value={delta} invert={invert} />
        </div>
        {bars && bars.length > 0 && <MiniBars values={bars} />}
      </div>
    </>
  );
  const cls = "block min-w-0 rounded-ds-lg border border-hairline bg-surface px-3.5 py-3";
  return href ? (
    <Link href={href} className={cx(cls, "hover:border-hairline-strong")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Card with label + big value + content (ref 05 "Total sales over time"). */
export function ChartCard({ label, value, children, className, action, footer }: { label: string; value?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; footer?: ReactNode }) {
  return (
    <section className={cx("min-w-0 rounded-ds-lg border border-hairline bg-surface px-3.5 py-3", className)}>
      <DataLabel action={action}>{label}</DataLabel>
      {value != null && <div className="mt-2 text-[20px] font-medium leading-none tracking-[-0.01em] tabular">{value}</div>}
      <div className="mt-3">{children}</div>
      {footer && <div className="mt-2">{footer}</div>}
    </section>
  );
}

export interface Series {
  label: string;
  values: number[];
  /** "current" draws the accent line; "compare" a muted one. */
  kind: "current" | "compare";
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function compact(n: number) {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Line chart (ref 05): y ticks on the left, x labels below, legend dots, hover crosshair. */
export function LineChart({ series, xLabels, height = 220, format = compact }: { series: Series[]; xLabels: string[]; height?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const W = 1000;
  const H = 100;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (n - 1)) * W).toFixed(1)},${(H - (v / max) * H).toFixed(2)}`).join(" ");
  const labelIdx = useMemo(() => {
    const k = Math.min(5, xLabels.length);
    return Array.from({ length: k }, (_, i) => Math.round((i / Math.max(1, k - 1)) * (xLabels.length - 1)));
  }, [xLabels.length]);
  const current = series.find((s) => s.kind === "current");
  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-0 text-right text-[11px] text-fg-faint tabular" style={{ height }}>
          {[...ticks].reverse().map((t) => (
            <span key={t} className="leading-none">
              {format(t)}
            </span>
          ))}
        </div>
        <div
          className="relative min-w-0 flex-1"
          style={{ height }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={H - (t / max) * H} y2={H - (t / max) * H} stroke="hsl(var(--ds-border))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) => (
              <path key={s.label} d={path(s.values)} fill="none" stroke={s.kind === "current" ? "hsl(var(--ds-accent))" : "hsl(var(--ds-accent) / 0.4)"} strokeWidth={s.kind === "current" ? 1.75 : 1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            ))}
            {hover != null && <line x1={(hover / (n - 1)) * W} x2={(hover / (n - 1)) * W} y1={0} y2={H} stroke="hsl(var(--ds-border-strong))" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover != null && current && (
            <div className="pointer-events-none absolute top-1 z-10 rounded-ds-sm border border-hairline bg-overlay px-2 py-1 text-[11.5px] shadow-ds-float" style={{ left: `calc(${(hover / (n - 1)) * 100}% + 8px)`, transform: hover > n * 0.7 ? "translateX(calc(-100% - 16px))" : undefined }}>
              <div className="text-fg-faint">{xLabels[hover]}</div>
              {series.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 tabular">
                  <span className={cx("size-1.5 rounded-full", s.kind === "current" ? "bg-ds-accent" : "bg-ds-accent/40")} />
                  {s.label}: {format(s.values[hover] ?? 0)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="relative ml-8 mt-2 h-4 text-[11px] text-fg-faint">
        {labelIdx.map((i) => (
          <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(i / Math.max(1, xLabels.length - 1)) * 100}%` }}>
            {xLabels[i]}
          </span>
        ))}
      </div>
      {series.length > 1 && (
        <div className="mt-3 flex justify-center gap-4 text-[11.5px] text-fg-muted">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className={cx("size-1.5 rounded-full", s.kind === "current" ? "bg-ds-accent" : "bg-ds-accent/40")} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny trend line for list rows (ref 05 breakdown: green up, red down, flat grey). */
export function Sparkline({ values, width = 22, height = 12 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === values[0])) return <span aria-hidden className="inline-block h-px bg-hairline-strong" style={{ width }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const up = values[values.length - 1]! >= values[0]!;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / (max - min || 1)) * height).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke={up ? "hsl(var(--ds-positive))" : "hsl(var(--ds-negative))"} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

/** Breakdown rows (ref 05): blue label, value right, sparkline, alternate row fill. */
export function BreakdownList({ rows }: { rows: { label: string; value: ReactNode; trend?: number[]; href?: string; total?: boolean }[] }) {
  return (
    <div className="-mx-1.5">
      {rows.map((r, i) => {
        const content = (
          <>
            <span className={cx("min-w-0 flex-1 truncate", r.total ? "font-medium text-fg" : "text-ds-accent")}>{r.label}</span>
            <span className="text-fg tabular">{r.value}</span>
            <Sparkline values={r.trend ?? []} />
          </>
        );
        const cls = cx("flex h-[30px] items-center gap-3 rounded-ds-sm px-1.5 text-[13px]", i % 2 === 1 && "bg-surface-2", r.href && "hover:bg-surface-3");
        return r.href ? (
          <Link key={r.label} href={r.href} className={cls}>
            {content}
          </Link>
        ) : (
          <div key={r.label} className={cls}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** Ranked list with bars (ref 05 "Top products"): label, value, count, accent bar. */
export function BarList({ rows }: { rows: { label: string; value?: ReactNode; count?: ReactNode; amount: number; href?: string; leading?: ReactNode }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              {r.leading}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.value != null && <span className="text-fg tabular">{r.value}</span>}
              {r.count != null && <span className="w-10 text-right text-fg-muted tabular">{r.count}</span>}
            </div>
            <div className="mt-1.5 h-[6px] rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-ds-accent" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%` }} />
            </div>
          </>
        );
        return r.href ? (
          <Link key={r.label} href={r.href} className="block rounded-ds-sm hover:opacity-90">
            {inner}
          </Link>
        ) : (
          <div key={r.label}>{inner}</div>
        );
      })}
    </div>
  );
}

/** Activity heatmap (ref 01): weeks × days of accent-tinted cells. */
export function Heatmap({ days, caption, range }: { days: { date: string; value: number }[]; caption?: ReactNode; range?: ReactNode }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const weeks: { date: string; value: number }[][] = [];
  days.forEach((d, i) => {
    const w = Math.floor(i / 7);
    (weeks[w] ??= []).push(d);
  });
  return (
    <div>
      <div className="flex gap-[3px] overflow-hidden">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((d) => {
              const t = d.value / max;
              return <span key={d.date} title={`${d.date}: ${d.value}`} className="size-[13px] rounded-ds-2xs" style={{ background: d.value === 0 ? "hsl(var(--ds-surface-3))" : `hsl(var(--ds-accent) / ${0.18 + t * 0.62})` }} />;
            })}
          </div>
        ))}
      </div>
      {(caption || range) && (
        <div className="mt-2.5 flex justify-between text-[12px] text-fg-muted">
          <span>{caption}</span>
          <span>{range}</span>
        </div>
      )}
    </div>
  );
}

/** Stat block (ref 01 "This month": label, large number, small delta beside it). */
export function StatBlock({ label, value, delta, tone = "accent" }: { label: string; value: ReactNode; delta?: ReactNode; tone?: "accent" | "fg" }) {
  return (
    <div>
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cx("text-[24px] font-medium leading-none tabular", tone === "accent" ? "text-ds-accent" : "text-fg")}>{value}</span>
        {delta && <span className="text-[12px] tabular">{delta}</span>}
      </div>
    </div>
  );
}

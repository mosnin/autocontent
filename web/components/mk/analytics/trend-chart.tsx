"use client";

import { useId, useState } from "react";
import { formatCompact } from "@/lib/format";
import { cx } from "../cx";

/**
 * Line chart for one period against the one before it (DESIGN.md chart rules):
 * an accent line for now, a muted line for the comparison, hairline grid,
 * tabular axis labels, crosshair + tooltip on hover. Lines live in a stretched
 * SVG (non-scaling strokes); every label is HTML so nothing distorts and the
 * server render matches the client. Could be promoted to components/mk/.
 */
export interface TrendPoint {
  day: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

const dayFmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

export function TrendChart({
  current,
  previous,
  format = formatCompact,
  height = 240,
  currentLabel = "This period",
  previousLabel = "Previous period",
  className,
}: {
  current: TrendPoint[];
  previous?: number[] | null;
  format?: (n: number) => string;
  height?: number;
  currentLabel?: string;
  previousLabel?: string;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = current.length;
  const prev = previous && previous.length === n ? previous : null;
  const max = niceMax(Math.max(1, ...current.map((p) => p.value), ...(prev ?? [])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const span = Math.max(1, n - 1);
  const x = (i: number) => (i / span) * 100;
  const y = (v: number) => 100 - (v / max) * 100;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(3)},${y(v).toFixed(3)}`).join("");
  const curVals = current.map((p) => p.value);
  const area = n > 1 ? `${path(curVals)}L100,100L0,100Z` : "";
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = current.map((p, i) => ({ i, day: p.day })).filter(({ i }) => i % labelEvery === 0 || i === n - 1).filter(({ i }, k, arr) => i === n - 1 || arr[k + 1]?.i - i >= labelEvery * 0.6);

  if (n === 0) return null;

  return (
    <div className={cx("relative select-none", className)} style={{ height }}>
      {/* y axis */}
      <div aria-hidden className="absolute bottom-6 left-0 top-2 w-10">
        {ticks.map((t) => (
          <span key={t} className="absolute right-2 -translate-y-1/2 text-[11px] text-faint tabular" style={{ top: `${y(t)}%` }}>
            {format(t)}
          </span>
        ))}
      </div>
      {/* plot */}
      <div
        className="absolute bottom-6 left-10 right-1 top-2"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          setHover(Math.round(f * span));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${currentLabel}: ${format(curVals.reduce((a, b) => a + b, 0))} total over ${n} days`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.12" />
              <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100" y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {area && <path d={area} fill={`url(#fill-${gid})`} />}
          {prev && <path d={path(prev)} fill="none" stroke="hsl(var(--faint))" strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          <path d={path(curVals)} fill="none" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover != null && (
          <>
            <span aria-hidden className="absolute inset-y-0 w-px bg-border-strong" style={{ left: `${x(hover)}%` }} />
            {prev && <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint ring-2 ring-card" style={{ left: `${x(hover)}%`, top: `${y(prev[hover])}%` }} />}
            <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card" style={{ left: `${x(hover)}%`, top: `${y(curVals[hover])}%` }} />
            <div
              className="t-pop pointer-events-none absolute top-0 z-10 min-w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-float"
              style={hover / span > 0.6 ? { right: `calc(${100 - x(hover)}% + 12px)` } : { left: `calc(${x(hover)}% + 12px)` }}
            >
              <div className="mb-1 text-muted-foreground">{dayFmt(current[hover].day, { weekday: "short", month: "short", day: "numeric" })}</div>
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-0.5 w-3 rounded-full bg-accent" />
                  {currentLabel}
                </span>
                <span className="font-medium tabular text-foreground">{format(curVals[hover])}</span>
              </div>
              {prev && (
                <div className="mt-0.5 flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-3 rounded-full bg-faint" />
                    {previousLabel}
                  </span>
                  <span className="tabular text-muted-foreground">{format(prev[hover])}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {/* x axis */}
      <div aria-hidden className="absolute bottom-0 left-10 right-1 h-5">
        {xLabels.map(({ i, day }) => (
          <span
            key={day}
            className={cx("absolute top-1 whitespace-nowrap text-[11px] text-faint tabular", i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: `${x(i)}%` }}
          >
            {dayFmt(day, { month: "short", day: "numeric" })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Two-line legend for a current vs comparison chart (identity is never colour alone: solid vs dashed). */
export function TrendLegend({ currentLabel = "This period", previousLabel = "Previous period" }: { currentLabel?: string; previousLabel?: string }) {
  return (
    <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full bg-accent" />
        {currentLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="2" aria-hidden>
          <line x1="0" x2="16" y1="1" y2="1" stroke="hsl(var(--faint))" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        {previousLabel}
      </span>
    </div>
  );
}

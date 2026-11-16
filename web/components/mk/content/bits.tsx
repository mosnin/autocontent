"use client";

/**
 * Small shared pieces for the work departments (Content, SEO, Playbooks).
 * Candidates for promotion into components/mk/ui.tsx once another area
 * needs them: StepList, LineSpark, Bars, useLiveRefresh, Time, Tabs.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Badge, CheckCircle, cx, Dot, Segmented } from "../ui";
import type { StatusTone } from "./status";

/** A timestamp that may differ between server and browser (time zone, "now"). */
export function Time({ iso, mode = "relative", className }: { iso: string | null | undefined; mode?: "relative" | "datetime"; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning className={className} title={formatDateTime(iso)}>
      {mode === "relative" ? formatRelative(iso) : formatDateTime(iso)}
    </time>
  );
}

/** Dot (only when something is happening or needs you) + one word of status. */
export function StatusWord({ label, tone, dot }: { label: string; tone: StatusTone; dot?: "live" | "warn" | "danger" | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot && <Dot tone={dot} />}
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

/** Refresh server data on an interval while something is still working. */
export function useLiveRefresh(active: boolean, ms = 6000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
}

/** Segmented tabs that keep ?tab= in the URL without a navigation. */
export function useUrlTab<T extends string>(initial: T, param = "tab"): [T, (v: T) => void] {
  const [tab, setTab] = useState<T>(initial);
  const set = (v: T) => {
    setTab(v);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(param, v);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* no-op */
    }
  };
  return [tab, set];
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return <Segmented value={value} onChange={onChange} options={options} label={label} className="w-full max-w-[360px]" />;
}

/** Vertical pipeline checklist: blue checks for done, dashed for to do, a live dot on the current step. */
export function StepList({ steps, current, complete, failed }: { steps: { id: string; label: string; detail?: string }[]; current: number; complete?: boolean; failed?: boolean }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const done = complete || i < current;
        const now = !complete && i === current;
        return (
          <li key={s.id} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className={cx("absolute left-[9.5px] top-[22px] h-[calc(100%-22px)] w-px", done ? "bg-accent/40" : "bg-border")} />}
            <span className="relative flex size-5 shrink-0 items-center justify-center">
              {done ? <CheckCircle /> : now ? failed ? <span className="size-[18px] rounded-full border-[1.5px] border-destructive bg-destructive/10" /> : <span className="flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-floor/50"><Dot tone="live" /></span> : <CheckCircle done={false} />}
            </span>
            <span className="min-w-0 pt-px">
              <span className={cx("block text-[14px]", done || now ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.label}
                {now && <span className={cx("ml-2 text-[12px] font-normal", failed ? "text-destructive" : "t-shimmer text-muted-foreground")}>{failed ? "Stopped here" : "Working"}</span>}
              </span>
              {s.detail && <span className="block text-[12px] text-faint">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One accent line over a hairline grid (views over time). No legend. */
export function LineSpark({ points, height = 120, format = (n: number) => String(n) }: { points: { label: string; value: number }[]; height?: number; format?: (n: number) => string }) {
  if (points.length < 2) return null;
  const w = 600;
  const pad = { t: 8, r: 8, b: 4, l: 8 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${d} L${x(points.length - 1).toFixed(1)},${height - pad.b} L${x(0).toFixed(1)},${height - pad.b} Z`;
  const last = points[points.length - 1];
  return (
    <div>
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`Latest ${format(last.value)}`}>
      {[0, 0.5, 1].map((g) => (
        <line key={g} x1={pad.l} x2={w - pad.r} y1={pad.t + g * (height - pad.t - pad.b)} y2={pad.t + g * (height - pad.t - pad.b)} stroke="hsl(var(--border))" strokeWidth={1} />
      ))}
      <path d={area} fill="hsl(var(--accent) / 0.08)" />
      <path d={d} fill="none" stroke="hsl(var(--accent))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={3.5} fill="hsl(var(--accent))" />
    </svg>
    <div className="mt-1 flex justify-between text-[11px] text-faint tabular">
      <span>{points[0].label}</span>
      <span>{last.label}</span>
    </div>
    </div>
  );
}

/** Daily bars (spend over time). Muted bars, the latest one foreground. */
export function Bars({ values, labels, height = 96, format = (n: number) => String(n) }: { values: number[]; labels?: [string, string]; height?: number; format?: (n: number) => string }) {
  const max = Math.max(0.0001, ...values);
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={`Peak ${format(max)}`}>
        {values.map((v, i) => (
          <span key={i} title={format(v)} className={cx("min-w-0 flex-1 rounded-[3px]", i === values.length - 1 ? "bg-foreground/70" : v > 0 ? "bg-muted-foreground/30" : "bg-muted")} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
        ))}
      </div>
      {labels && (
        <div className="mt-1.5 flex justify-between text-[11px] text-faint tabular">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

/** Label/value pairs in a quiet grid (metadata panels). */
export function Meta({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border">
      {items.map((it) => (
        <div key={it.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-[13px] text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 text-right text-[14px] [overflow-wrap:anywhere]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline result line after a mutation (instead of a toast). */
export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" | "live" }) {
  if (!children) return null;
  return <p role={tone === "danger" ? "alert" : "status"} className={cx("text-[13px]", tone === "danger" ? "text-destructive" : tone === "live" ? "text-floor" : "text-muted-foreground")}>{children}</p>;
}

export async function postProxy(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/api/proxy${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* not json */
    }
    throw new Error(res.status === 402 ? "That would go over today's spend cap." : res.status === 409 ? `Already handled: ${detail}`.slice(0, 160) : detail.slice(0, 160) || `Failed (${res.status})`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

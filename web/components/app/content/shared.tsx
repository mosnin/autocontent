"use client";

/**
 * Small pieces shared by the work tools (Content, SEO, Playbooks), composed
 * from design-system primitives: a timestamp, a conditional live refresh,
 * the pipeline step list and the URL-synced tab.
 */
import { useState, type ReactNode } from "react";
import { cx, StepMark, ToolIcon } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { DepartmentId } from "@/lib/departments";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAutoRefresh } from "@/lib/proxy-fetch";

/** A timestamp that may differ between server and browser (time zone, "now"). */
export function Time({ iso, mode = "relative", className }: { iso: string | null | undefined; mode?: "relative" | "datetime"; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning className={className} title={formatDateTime(iso)}>
      {mode === "relative" ? formatRelative(iso) : formatDateTime(iso)}
    </time>
  );
}

function Refresher({ ms }: { ms: number }) {
  useAutoRefresh(ms);
  return null;
}

/** Re-fetch server data on an interval, only while something is still working. */
export function LiveRefresh({ active, ms = 6000 }: { active: boolean; ms?: number }) {
  return active ? <Refresher ms={ms} /> : null;
}

/** Tabs that keep ?tab= in the URL without a navigation. */
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

/** A pipeline as plan-card steps (ref 02): filled check for done, spinner on the current step. */
export function StepList({ steps, current, complete, failed }: { steps: { id: string; label: string; detail?: string }[]; current: number; complete?: boolean; failed?: boolean }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const done = complete || i < current;
        const now = !complete && i === current;
        return (
          <li key={s.id} className="flex items-start gap-2.5 text-[13px]">
            <span className="mt-[2px]">
              <StepMark state={done ? "done" : now ? (failed ? "failed" : "active") : "todo"} />
            </span>
            <span className="min-w-0">
              <span className={cx(done || now ? "text-fg" : "text-fg-muted")}>{s.label}</span>
              {now && <span className={cx("ml-2 text-[12px]", failed ? "text-negative" : "text-fg-faint")}>{failed ? "Stopped here" : "Working"}</span>}
              {s.detail && <span className="block text-[12px] text-fg-faint">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Tool page title (Tool template): the tool's coloured icon beside the 22px title. */
export function ToolTitle({ tool, children }: { tool: DepartmentId; children: ReactNode }) {
  const t = TOOL_ICON[tool];
  return (
    <span className="flex items-center gap-2.5">
      <ToolIcon tone={t.tone} size={22}>
        {t.icon}
      </ToolIcon>
      {children}
    </span>
  );
}

/** The plain header icon for a tool's pages (refs 05/07 show a muted line icon in the 48px header). */
export const toolGlyph = (tool: DepartmentId) => TOOL_ICON[tool].icon;

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

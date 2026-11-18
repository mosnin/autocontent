"use client";

/**
 * Small pieces shared by the work tools (Content, SEO, Playbooks): a
 * conditional live refresh, the URL-synced tab and the tool's header glyph.
 * Visual parts (Time, StepList, StatLine, ToolTitle) live in the design system.
 */
import { useState } from "react";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { DepartmentId } from "@/lib/departments";
import { useAutoRefresh } from "@/lib/proxy-fetch";

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

/** The plain header icon for a tool's pages (refs 05/07 show a muted line icon in the 48px header). */
export const toolGlyph = (tool: DepartmentId) => TOOL_ICON[tool].icon;

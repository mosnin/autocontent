// Pure, framework-free helpers shared across the admin surface. No React,
// no client hooks — safe to import from server or client components.

import type { BadgeVariant } from "@/components/ui/badge";

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Human labels for the dotted audit action keys. Anything not listed falls
// back to a title-cased split so new backend actions still read cleanly.
const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended user",
  "user.unsuspend": "Reinstated user",
  "user.role_change": "Changed role",
  "user.role": "Changed role",
  "user.credits_grant": "Granted credits",
  "user.credit_grant": "Granted credits",
  "user.credits": "Adjusted credits",
};

export function humanizeAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

/** Badge tone for an action, so the audit log scans by severity. */
export function actionTone(action: string): BadgeVariant {
  if (action.includes("suspend") && !action.includes("unsuspend"))
    return "destructive";
  if (action.includes("role")) return "warning";
  if (action.includes("credit")) return "info";
  if (action.includes("unsuspend")) return "success";
  return "secondary";
}

/** Short relative time, e.g. "3m ago". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** Absolute, locale-formatted timestamp for tooltips / detail rows. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact integer, e.g. 12_300 → "12.3k". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

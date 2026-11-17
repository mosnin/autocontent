// Pure helpers for the admin console. No React; safe on server or client.
import type { StatusTone } from "@/design-system";

const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended user",
  "user.unsuspend": "Reinstated user",
  "user.role_change": "Changed role",
  "user.role": "Changed role",
  "user.credits_grant": "Granted credits",
  "user.credit_grant": "Granted credits",
  "user.credits": "Adjusted credits",
};

const capitalize = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** Human label for a dotted audit action key; unknown keys are title-cased. */
export function humanizeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.split(/[._]/).filter(Boolean).map(capitalize).join(" ");
}

/** Status tone for an audit action, so the log scans by severity. */
export function actionTone(action: string): StatusTone {
  if (action.includes("unsuspend")) return "positive";
  if (action.includes("suspend")) return "negative";
  if (action.includes("role")) return "attention";
  if (action.includes("credit")) return "accent";
  return "neutral";
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
  return `${Math.round(hr / 24)}d ago`;
}

/** Absolute, locale-formatted timestamp for titles and detail rows. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Compact integer, e.g. 12_300 → "12.3k". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

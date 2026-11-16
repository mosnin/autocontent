/** Formats USD, with sub-cent precision for the small numbers model calls produce. */
export function formatUsd(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** `h:mm:ss` (or `m:ss` under an hour) for runtimes in seconds. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Human duration for tool calls: `850 ms`, `1.2 s`, `2m 05s`. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Locale time of day with seconds, for log lines. */
export function formatTimeOfDay(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** ISO-8601 for a `<time dateTime>`, or `undefined` for out-of-range timestamps. */
export function isoTime(timestamp: number): string | undefined {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Pretty-prints a value for display: JSON strings are re-indented, other
 * strings pass through, and circular or unserializable values degrade to
 * `String(value)` instead of throwing.
 */
export function prettyValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(
      value,
      (_key, inner: unknown) => {
        if (typeof inner === "bigint") return inner.toString();
        if (typeof inner === "object" && inner !== null) {
          if (seen.has(inner)) return "[Circular]";
          seen.add(inner);
        }
        return inner;
      },
      2,
    );
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/** Joins truthy class names. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Initials for an avatar: `planner-agent` → `PA`. */
export function initials(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.:/]+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? name).slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** Whether a URL is safe to open from model-authored content. */
export function isSafeUrl(url: string): boolean {
  try {
    const base = typeof globalThis.location === "undefined" ? "https://localhost" : globalThis.location.href;
    const parsed = new URL(url, base);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Black or white, whichever reads better on a hex background color. */
export function readableTextColor(background: string): string | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim());
  if (!match?.[1]) return undefined;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Contrast against white vs. against near-black (#111827, luminance ≈ 0.012).
  return (1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.062) ? "#ffffff" : "#111827";
}

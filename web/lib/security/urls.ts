// URL and path checks shared by server actions and route handlers.

/** An id safe to place in a backend path: no separators, dots or encodings. Null when it isn't one. */
export function idSegment(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
}

/** An absolute https URL to send the browser to (OAuth, checkout). Null for anything else, including javascript: and data:. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A same-site path for a return URL: one leading slash, no scheme, no `//` or `/\` host tricks. Falls back otherwise. */
export function safeReturnPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f\\]/.test(value)) return fallback;
  return value;
}

/** Shape a backend failure for the browser: keep the status prefix callers match on, bound the detail, hide 5xx bodies. */
export function publicApiError(status: number, body: string): string {
  if (status >= 500) return `${status} The service had a problem. Try again in a moment.`;
  let detail = "";
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    if (typeof j.detail === "string") detail = j.detail;
    else if (Array.isArray(j.detail)) detail = j.detail.map((d: { msg?: unknown }) => (typeof d?.msg === "string" ? d.msg : "")).filter(Boolean).join(", ");
  } catch {
    // Not JSON (a proxy or gateway page): never echo it.
  }
  return `${status} ${detail.slice(0, 300) || "Request failed"}`.trim();
}

/** Whether /preview/** is served. Off in production unless ENABLE_PREVIEW=1; on in dev unless ENABLE_PREVIEW=0. */
export function previewEnabled(env: { NODE_ENV?: string; ENABLE_PREVIEW?: string }): boolean {
  const flag = env.ENABLE_PREVIEW?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return env.NODE_ENV !== "production";
}

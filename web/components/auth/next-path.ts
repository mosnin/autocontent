// Where to go after an auth step: the `next` query value when it is a same-site
// path, else /home. Never an absolute URL (open redirect).
export function nextPath(raw: string | null | undefined, fallback = "/home"): string {
  if (typeof raw !== "string" || raw.length > 2048) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f\\]/.test(raw)) return fallback;
  return raw;
}

export function withNext(path: string, next: string | null | undefined): string {
  const n = nextPath(next, "");
  return n ? `${path}?next=${encodeURIComponent(n)}` : path;
}

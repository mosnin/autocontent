// Pure policy for /api/proxy: where a request may go, which headers cross the
// boundary, and which callers may mutate. No Next or Clerk imports, so the
// Node test runner can load this file directly (web/test/security.test.ts).

/** Backend path prefixes the proxy will forward. Everything the app calls lives under /api/v1/. */
export const ALLOWED_PATH_PREFIXES: readonly string[] = ["api/v1/"];

/** Largest request body the proxy forwards (JSON mutations; uploads don't go through it). */
export const MAX_PROXY_BODY_BYTES = 1024 * 1024;

export type Upstream = { ok: true; url: string } | { ok: false; status: number; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Build the upstream URL from the configured backend origin and the catch-all
 * segments. The host comes from `base` only: no header, query or path segment
 * can change it. Segments are re-encoded, dot segments and separators are
 * refused, and the final URL is re-parsed and checked against the origin and
 * the allowlisted prefix.
 */
export function resolveUpstream(base: string | undefined, segments: readonly string[], search = "", opts: { production?: boolean; prefixes?: readonly string[] } = {}): Upstream {
  let origin: URL;
  try {
    origin = new URL(base ?? "");
  } catch {
    return { ok: false, status: 503, error: "backend is not configured" };
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") return { ok: false, status: 503, error: "backend is not configured" };
  if (origin.username || origin.password) return { ok: false, status: 503, error: "backend is not configured" };
  // The user's token rides on this hop: plain http only to a local backend.
  if (opts.production && origin.protocol !== "https:" && !LOCAL_HOSTS.has(origin.hostname)) return { ok: false, status: 503, error: "backend is not configured" };

  if (segments.length === 0 || segments.length > 32) return { ok: false, status: 404, error: "not found" };
  for (const s of segments) {
    // eslint-disable-next-line no-control-regex
    if (!s || s === "." || s === ".." || s.length > 512 || /[\/\\\u0000-\u001f\u007f]/.test(s)) return { ok: false, status: 404, error: "not found" };
  }
  const path = segments.map(encodeURIComponent).join("/");
  const prefixes = opts.prefixes ?? ALLOWED_PATH_PREFIXES;
  if (!prefixes.some((p) => `${path}/`.startsWith(p))) return { ok: false, status: 404, error: "not found" };

  if (search && !search.startsWith("?")) return { ok: false, status: 400, error: "bad query" };
  if (search.length > 8192) return { ok: false, status: 414, error: "query too long" };

  const basePath = origin.pathname.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${origin.origin}${basePath}/${path}${search}`);
  } catch {
    return { ok: false, status: 404, error: "not found" };
  }
  if (url.origin !== origin.origin || !prefixes.some((p) => `${url.pathname}/`.startsWith(`${basePath}/${p}`))) return { ok: false, status: 404, error: "not found" };
  return { ok: true, url: url.toString() };
}

/** The only request headers that reach the backend. Cookies, Host, X-Forwarded-* and any client Authorization never do. */
const FORWARD_REQUEST = ["content-type", "accept", "range", "if-range", "if-none-match", "if-modified-since"] as const;

export function upstreamRequestHeaders(incoming: { get(name: string): string | null }, token: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARD_REQUEST) {
    const v = incoming.get(name);
    if (v && v.length <= 1024) out[name] = v;
  }
  out.authorization = `Bearer ${token}`;
  return out;
}

/** Response headers that never go back to the browser. */
const DROP_RESPONSE = new Set([
  // hop-by-hop (RFC 9110 §7.6.1)
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // the backend must not set cookies, CORS or transport policy on the app's origin
  "set-cookie",
  "set-cookie2",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "clear-site-data",
  "alt-svc",
  "public-key-pins",
  // infrastructure fingerprints
  "server",
  "via",
  "x-powered-by",
]);

/** Content types a browser would run as a document on the app's origin. */
const ACTIVE_CONTENT = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i;

export function downstreamResponseHeaders(upstream: Iterable<[string, string]>): Headers {
  const out = new Headers();
  let encoded = false;
  for (const [k, v] of upstream) {
    const lk = k.toLowerCase();
    if (DROP_RESPONSE.has(lk) || lk.startsWith("access-control-")) continue;
    if (lk === "content-encoding") {
      // fetch() already decoded the body; the original encoding and length no longer describe it.
      encoded = true;
      continue;
    }
    out.set(k, v);
  }
  if (encoded) out.delete("content-length");
  out.set("x-content-type-options", "nosniff");
  // Backend responses are data, never pages: if one is HTML or SVG and someone
  // navigates to it, it renders with no scripts and an opaque origin.
  if (ACTIVE_CONTENT.test(out.get("content-type") ?? "")) out.set("content-security-policy", "default-src 'none'; sandbox");
  if (!out.has("cache-control")) out.set("cache-control", "private, no-store");
  return out;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for state-changing requests. The browser sets `Origin` on every
 * non-GET fetch and form post; it must match the host the request was sent to.
 * With no Origin we accept only `Sec-Fetch-Site: same-origin`. Anything else,
 * including a request with neither header, is refused.
 */
export function isSameOriginRequest(method: string, headers: { get(name: string): string | null }): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const host = (headers.get("x-forwarded-host")?.split(",")[0] ?? headers.get("host") ?? "").trim().toLowerCase();
  const origin = headers.get("origin");
  if (origin) {
    if (!host) return false;
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false; // "null" and other opaque origins
    }
  }
  return headers.get("sec-fetch-site") === "same-origin";
}

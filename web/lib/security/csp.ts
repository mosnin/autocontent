// Content-Security-Policy for the pages the middleware serves (the app, the
// auth pages, onboarding): a per-request nonce with 'strict-dynamic'. Built
// here, applied in web/middleware.ts, documented in docs/security/web-audit.md.
// The static policy for pages the middleware never sees is in next.config.js.

type Env = Record<string, string | undefined>;

/** `https://host` → itself plus `wss://host` (the agent streams over both). Invalid or non-http(s) values are dropped. */
function originSources(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    return [u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`];
  } catch {
    return [];
  }
}

/** Extra connect-src hosts from CSP_CONNECT_SRC (space or comma separated origins, e.g. a Pusher cluster). */
function extraConnect(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .filter((s) => /^(https|wss):\/\/[A-Za-z0-9.*-]+(:\d+)?$/.test(s));
}

/**
 * Directives that vary by deployment or feature, merged into the strict
 * policy by buildCsp().
 *
 * - img-src: data: and blob: are needed by the page-transition shader, which
 *   rasterises the DOM through an SVG <foreignObject> image with inlined
 *   assets (web/vendor/distortion-waves). https: covers presigned media and
 *   social avatars.
 * - font-src: data: for the same reason (fonts are inlined into that SVG).
 * - connect-src: 'self' (the proxy, and the shader re-fetching the page's own
 *   CSS and images) plus the agent origin. No 'unsafe-eval' anywhere.
 */
export function appCspDirectives(env: Env): Record<string, string[]> {
  return {
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", ...originSources(env.NEXT_PUBLIC_AGENT_ORIGIN), ...extraConnect(env.CSP_CONNECT_SRC)],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
}

/** Report-only until CSP_MODE=enforce, so a regression shows up as reports before it can break a page. */
export function cspReportOnly(env: Env): boolean {
  return env.CSP_MODE?.trim() !== "enforce";
}

/** A fresh nonce: 16 random bytes, base64. Works in the Edge runtime and in Node. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * The strict policy for one response.
 *
 * - script-src: the nonce and 'strict-dynamic'. Scripts Next loads from a
 *   nonced script are trusted; nothing inline without the nonce runs, and
 *   host allowlists are ignored by browsers that understand strict-dynamic.
 *   'unsafe-eval' only in development (React Refresh needs it).
 * - style-src: 'unsafe-inline' (React style attributes and next/font).
 * - frame-src 'none': no third-party widgets since the auth provider moved in-house.
 * - form-action 'self': forms post only to this origin.
 */
export function buildCsp(nonce: string, env: Env): string {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(nonce)) throw new Error("invalid nonce");
  const dev = env.NODE_ENV !== "production";
  const extra = appCspDirectives(env);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "form-action": ["'self'"],
    "manifest-src": ["'self'"],
    ...extra,
  };
  // HMR websocket in development.
  if (dev) directives["connect-src"] = [...directives["connect-src"]!, "ws:", "wss:"];
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

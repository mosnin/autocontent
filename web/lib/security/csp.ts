// Content-Security-Policy pieces shared by the middleware (nonce-based policy
// on Clerk-routed pages) and documented in docs/security/web-audit.md. The
// static policy for pages the middleware never sees is in next.config.js.

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
 * Directives merged into Clerk's strict policy (which supplies default-src,
 * the nonce + strict-dynamic script-src, style-src, frame-src for the
 * challenge widget and its own connect/img hosts).
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

/** Report-only until CSP_MODE=enforce: the policy has not been exercised against a live Clerk instance. */
export function cspReportOnly(env: Env): boolean {
  return env.CSP_MODE?.trim() !== "enforce";
}

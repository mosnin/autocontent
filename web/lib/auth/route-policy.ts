// What the middleware does with a request, decided from the path and whether
// a session cookie is present. Pure, so it is unit-tested.
//
// This is the optimistic check only: a cookie that is present may still be
// expired or revoked. The (app) and (onboarding) layouts and every route
// handler validate the session against the database; this just saves a
// round trip for people who are plainly signed out.

/** Every app route. Keep in sync with AUTH_ROUTES in next.config.js and the matcher in middleware.ts. */
export const APP_SEGMENTS = ["home", "activity", "inbox", "sessions", "analytics", "plan", "library", "content", "seo", "paid", "distribution", "playbooks", "brand", "memory", "integrations", "settings", "onboarding", "admin"] as const;

/** Auth pages: public, but served with the strict CSP. */
export const AUTH_SEGMENTS = ["sign-in", "sign-up", "verify-email", "forgot-password", "reset-password", "two-factor", "accept-invitation"] as const;

const APP_RE = new RegExp(`^/(?:${APP_SEGMENTS.join("|")})(?:/.*)?$`);
const AUTH_RE = new RegExp(`^/(?:${AUTH_SEGMENTS.join("|")})(?:/.*)?$`);
/** API routes that need a signed-in person. /api/media keeps a public GET; /api/auth is Better Auth's own. */
const PROTECTED_API_RE = /^\/api\/(?:proxy|agent|onboarding)(?:\/.*)?$/;

export type RouteDecision = { action: "next"; csp: boolean } | { action: "redirect"; location: string } | { action: "unauthorized" };

export function isAppPath(pathname: string): boolean {
  return APP_RE.test(pathname);
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_RE.test(pathname);
}

/** The sign-in URL that brings the person back to where they were going. Only same-site paths survive. */
export function signInUrl(pathname: string, search = ""): string {
  const next = `${pathname}${search}`;
  const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && next.length <= 2048 ? next : "/home";
  return `/sign-in?next=${encodeURIComponent(safe)}`;
}

export function decideRoute(input: { pathname: string; search?: string; hasSessionCookie: boolean }): RouteDecision {
  const { pathname, hasSessionCookie } = input;
  if (PROTECTED_API_RE.test(pathname)) return hasSessionCookie ? { action: "next", csp: false } : { action: "unauthorized" };
  if (isAppPath(pathname)) return hasSessionCookie ? { action: "next", csp: true } : { action: "redirect", location: signInUrl(pathname, input.search ?? "") };
  if (isAuthPath(pathname)) return { action: "next", csp: true };
  return { action: "next", csp: false };
}

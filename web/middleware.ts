import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { decideRoute } from "@/lib/auth/route-policy";
import { buildCsp, createNonce, cspReportOnly } from "@/lib/security/csp";
import { previewEnabled } from "@/lib/security/urls";

// Edge middleware. Three jobs:
//  1. The fixture preview (/preview/**) is gated by ENABLE_PREVIEW and has no auth.
//  2. An optimistic sign-in check from the session cookie alone (decideRoute in
//     lib/auth/route-policy.ts): pages redirect to /sign-in?next=…, APIs get 401.
//     The cookie is not trusted: layouts and route handlers validate the session
//     against the database.
//  3. A per-request nonce and the strict CSP on app and auth pages, report-only
//     until CSP_MODE=enforce (docs/security/web-audit.md).

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // The fixture preview has no auth. It exists for design review and the
  // screenshot tooling, so it is served in development and, in production,
  // only when ENABLE_PREVIEW=1.
  if (pathname === "/preview" || pathname.startsWith("/preview/")) {
    if (!previewEnabled(process.env)) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
    const res = NextResponse.next();
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }

  const hasSessionCookie = Boolean(getSessionCookie(req, { cookiePrefix: "marketer" }));
  const decision = decideRoute({ pathname, search, hasSessionCookie });

  if (decision.action === "unauthorized") return NextResponse.json({ detail: "sign in to continue" }, { status: 401, headers: { "cache-control": "no-store" } });
  if (decision.action === "redirect") return NextResponse.redirect(new URL(decision.location, req.url));
  if (!decision.csp) return NextResponse.next();

  const nonce = createNonce();
  const policy = buildCsp(nonce, process.env);
  // Next reads the nonce from the request's CSP header and puts it on its own scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  // Layouts use it to send people back to where they were (sign-in, two-factor setup).
  requestHeaders.set("x-pathname", `${pathname}${search}`.slice(0, 2048));
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(cspReportOnly(process.env) ? "content-security-policy-report-only" : "content-security-policy", policy);
  return res;
}

export const config = {
  // Only where auth exists: the app, the auth pages, the APIs that need a
  // person, and the preview gate. Marketing pages never run middleware.
  // Legacy routes (/dashboard, /ads, …) redirect in next.config.js first.
  matcher: [
    "/(home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|memory|integrations|settings|onboarding|admin)(.*)",
    "/(sign-in|sign-up|verify-email|forgot-password|reset-password|two-factor|accept-invitation)(.*)",
    "/api/proxy(.*)",
    "/api/agent(.*)",
    "/api/onboarding(.*)",
    "/preview(.*)",
  ],
};

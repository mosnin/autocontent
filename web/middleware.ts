import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { appCspDirectives, cspReportOnly } from "@/lib/security/csp";
import { previewEnabled } from "@/lib/security/urls";

// Every app route. Keep in sync with the matcher below and CLERK_ROUTES in next.config.js.
const APP = "home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|integrations|settings|onboarding|admin";

// Signed-out requests to these are redirected to sign-in (pages) or refused (API).
// /api/proxy answers 401 itself; /api/media keeps a public GET and checks admin in-route for writes.
const isProtected = createRouteMatcher([new RegExp(`^/(${APP})(/.*)?$`), "/api/agent(.*)", "/api/onboarding(.*)"]);

const clerk = clerkMiddleware(
  async (auth, req) => {
    if (isProtected(req)) await auth.protect();
  },
  {
    // Nonce-based policy ('strict-dynamic') with Clerk's own hosts, plus ours.
    // Report-only until CSP_MODE=enforce; see docs/security/web-audit.md.
    contentSecurityPolicy: { strict: true, reportOnly: cspReportOnly(process.env), directives: appCspDirectives(process.env) },
  },
);

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  // The fixture preview has no auth. It exists for design review and the
  // screenshot tooling, so it is served in development and, in production,
  // only when ENABLE_PREVIEW=1. It never goes through Clerk.
  if (req.nextUrl.pathname === "/preview" || req.nextUrl.pathname.startsWith("/preview/")) {
    if (!previewEnabled(process.env)) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
    const res = NextResponse.next();
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }
  return clerk(req, event);
}

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // the JWT-attaching proxy and the agent session route. Marketing pages
  // never touch Clerk (no handshake redirects, no clerk-js in their bundles).
  // Legacy routes (/dashboard, /ads, …) redirect in next.config.js first.
  matcher: [
    "/(home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|integrations|settings|onboarding|admin)(.*)",
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
    "/api/agent(.*)",
    // Onboarding decisions (server-side model key; signed-in users only).
    "/api/onboarding(.*)",
    // Media manager: GET stays public, POST/DELETE check auth() in-route.
    "/api/media",
    // Fixture preview: gated above, never reaches Clerk.
    "/preview(.*)",
  ],
};
